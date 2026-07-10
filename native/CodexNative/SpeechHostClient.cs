using CodexNative.Core;
using System.Diagnostics;
using System.Text.Json;

namespace CodexNative;

internal sealed class SpeechHostClient : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly NativePlatformProfile _platform;
    private readonly SemaphoreSlim _startGate = new(1, 1);
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly CancellationTokenSource _shutdown = new();
    private Process? _process;
    private Task? _stdoutTask;
    private Task? _stderrTask;
    private TaskCompletionSource _ready = NewReadySource();
    private int _disposed;

    public SpeechHostClient(NativePlatformProfile platform)
    {
        _platform = platform;
    }

    public event Action<SpeechHostEvent>? MessageReceived;

    public bool IsRunning
    {
        get
        {
            var process = Volatile.Read(ref _process);
            try { return process is { HasExited: false }; }
            catch (InvalidOperationException) { return false; }
        }
    }

    public async Task EnsureStartedAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await _startGate.WaitAsync(cancellationToken);
        try
        {
            ThrowIfDisposed();
            Process process;
            TaskCompletionSource ready;
            if (!IsRunning)
            {
                var previous = Interlocked.Exchange(ref _process, null);
                if (previous is not null) previous.Dispose();
                var executable = Path.Combine(AppContext.BaseDirectory, _platform.SpeechHostFileName);
                if (!File.Exists(executable))
                    throw new FileNotFoundException(
                        "The native speech host is missing. Reinstall or republish Codex Native.",
                        executable);
                ready = NewReadySource();
                _ready = ready;
                var startInfo = new ProcessStartInfo(executable)
                {
                    WorkingDirectory = AppContext.BaseDirectory,
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                };
                process = Process.Start(startInfo)
                    ?? throw new InvalidOperationException("Could not start the native speech host.");
                if (IsDisposed)
                {
                    TerminateProcess(process);
                    process.Dispose();
                    ThrowIfDisposed();
                }
                _process = process;
                if (IsDisposed)
                {
                    if (ReferenceEquals(Interlocked.CompareExchange(ref _process, null, process), process))
                    {
                        TerminateProcess(process);
                        process.Dispose();
                    }
                    ThrowIfDisposed();
                }
                process.EnableRaisingEvents = true;
                process.Exited += (_, _) =>
                {
                    ready.TrySetException(new InvalidOperationException(
                        "The native speech host exited before becoming ready."));
                    if (!_shutdown.IsCancellationRequested
                        && ReferenceEquals(Volatile.Read(ref _process), process))
                        MessageReceived?.Invoke(new SpeechHostEvent(
                            "error",
                            Error: "The native speech host exited unexpectedly."));
                };
                _stdoutTask = ReadStdoutAsync(process, ready, _shutdown.Token);
                _stderrTask = ReadStderrAsync(process, _shutdown.Token);
            }
            else
            {
                process = Volatile.Read(ref _process)
                    ?? throw new InvalidOperationException("The native speech host is not running.");
                ready = _ready;
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            try
            {
                await ready.Task.WaitAsync(timeout.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                StopProcess(process);
                throw new TimeoutException("The native speech host did not become ready within 15 seconds.");
            }
        }
        finally
        {
            _startGate.Release();
        }
    }

    public async Task SendAsync(SpeechHostCommand command, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await EnsureStartedAsync(cancellationToken);
        ThrowIfDisposed();
        var process = _process ?? throw new InvalidOperationException("The native speech host is not running.");
        await _writeGate.WaitAsync(cancellationToken);
        try
        {
            await process.StandardInput.WriteLineAsync(
                JsonSerializer.Serialize(command, JsonOptions).AsMemory(),
                cancellationToken);
            await process.StandardInput.FlushAsync(cancellationToken);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    private async Task ReadStdoutAsync(
        Process process,
        TaskCompletionSource ready,
        CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await process.StandardOutput.ReadLineAsync(cancellationToken);
                if (line is null) break;
                try
                {
                    var message = JsonSerializer.Deserialize<SpeechHostEvent>(line, JsonOptions);
                    if (message is null) continue;
                    if (message.Type == "ready") ready.TrySetResult();
                    if (ReferenceEquals(Volatile.Read(ref _process), process))
                        MessageReceived?.Invoke(message);
                }
                catch (JsonException ex)
                {
                    NativeLog.Write($"Ignoring malformed speech-host output: {ex.Message}");
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception ex)
        {
            NativeLog.Write($"Speech-host output reader failed: {ex}");
        }
    }

    private static async Task ReadStderrAsync(Process process, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await process.StandardError.ReadLineAsync(cancellationToken);
                if (line is null) break;
                NativeLog.Write($"Speech host: {line}");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception ex)
        {
            NativeLog.Write($"Speech-host error reader failed: {ex.Message}");
        }
    }

    private static TaskCompletionSource NewReadySource() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public void ForceStop() => TerminateProcess(Volatile.Read(ref _process));

    private void StopProcess(Process process)
    {
        if (!ReferenceEquals(Interlocked.CompareExchange(ref _process, null, process), process)) return;
        TerminateProcess(process);
        process.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _shutdown.Cancel();
        var process = Volatile.Read(ref _process);
        try
        {
            if (process is not null) await RequestShutdownAsync(process);
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Speech host shutdown request failed: {ex.Message}");
        }
        finally
        {
            TerminateProcess(process);
            if (process is not null
                && ReferenceEquals(Interlocked.CompareExchange(ref _process, null, process), process))
                process.Dispose();
        }
        if (_stdoutTask is not null) try { await _stdoutTask; } catch { }
        if (_stderrTask is not null) try { await _stderrTask; } catch { }
        _shutdown.Dispose();
        _startGate.Dispose();
        _writeGate.Dispose();
    }

    private async Task RequestShutdownAsync(Process process)
    {
        if (process.HasExited) return;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await _writeGate.WaitAsync(timeout.Token);
        try
        {
            if (!process.HasExited)
            {
                await process.StandardInput.WriteLineAsync(
                    JsonSerializer.Serialize(new SpeechHostCommand("shutdown"), JsonOptions).AsMemory(),
                    timeout.Token);
                await process.StandardInput.FlushAsync(timeout.Token);
            }
        }
        finally
        {
            _writeGate.Release();
        }
        await process.WaitForExitAsync(timeout.Token);
    }

    private static void TerminateProcess(Process? process)
    {
        if (process is null) return;
        try
        {
            if (process.HasExited) return;
            process.Kill(entireProcessTree: true);
            process.WaitForExit(1000);
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Could not terminate speech host: {ex.Message}");
        }
    }

    private bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    private void ThrowIfDisposed()
    {
        if (IsDisposed) throw new ObjectDisposedException(nameof(SpeechHostClient));
    }
}
