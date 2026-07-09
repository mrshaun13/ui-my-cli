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

    public SpeechHostClient(NativePlatformProfile platform)
    {
        _platform = platform;
    }

    public event Action<SpeechHostEvent>? MessageReceived;

    public bool IsRunning => _process is { HasExited: false };

    public async Task EnsureStartedAsync(CancellationToken cancellationToken = default)
    {
        if (IsRunning)
        {
            await _ready.Task.WaitAsync(cancellationToken);
            return;
        }

        await _startGate.WaitAsync(cancellationToken);
        try
        {
            if (!IsRunning)
            {
                var executable = Path.Combine(AppContext.BaseDirectory, _platform.SpeechHostFileName);
                if (!File.Exists(executable))
                    throw new FileNotFoundException(
                        "The native speech host is missing. Reinstall or republish Codex Native.",
                        executable);
                _ready = NewReadySource();
                var startInfo = new ProcessStartInfo(executable)
                {
                    WorkingDirectory = AppContext.BaseDirectory,
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                };
                _process = Process.Start(startInfo)
                    ?? throw new InvalidOperationException("Could not start the native speech host.");
                _process.EnableRaisingEvents = true;
                _process.Exited += (_, _) =>
                {
                    if (!_shutdown.IsCancellationRequested)
                        MessageReceived?.Invoke(new SpeechHostEvent(
                            "error",
                            Error: "The native speech host exited unexpectedly."));
                };
                _stdoutTask = ReadStdoutAsync(_process, _shutdown.Token);
                _stderrTask = ReadStderrAsync(_process, _shutdown.Token);
            }
        }
        finally
        {
            _startGate.Release();
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            await _ready.Task.WaitAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException("The native speech host did not become ready within 15 seconds.");
        }
    }

    public async Task SendAsync(SpeechHostCommand command, CancellationToken cancellationToken = default)
    {
        await EnsureStartedAsync(cancellationToken);
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

    private async Task ReadStdoutAsync(Process process, CancellationToken cancellationToken)
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
                    if (message.Type == "ready") _ready.TrySetResult();
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

    public async ValueTask DisposeAsync()
    {
        _shutdown.Cancel();
        var process = _process;
        if (process is not null)
        {
            try
            {
                if (!process.HasExited)
                {
                    await _writeGate.WaitAsync();
                    try
                    {
                        await process.StandardInput.WriteLineAsync(
                            JsonSerializer.Serialize(new SpeechHostCommand("shutdown"), JsonOptions));
                        await process.StandardInput.FlushAsync();
                    }
                    finally
                    {
                        _writeGate.Release();
                    }
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    try { await process.WaitForExitAsync(timeout.Token); }
                    catch (OperationCanceledException) { process.Kill(entireProcessTree: true); }
                }
            }
            catch { }
            process.Dispose();
        }
        if (_stdoutTask is not null) try { await _stdoutTask; } catch { }
        if (_stderrTask is not null) try { await _stderrTask; } catch { }
        _shutdown.Dispose();
        _startGate.Dispose();
        _writeGate.Dispose();
    }
}
