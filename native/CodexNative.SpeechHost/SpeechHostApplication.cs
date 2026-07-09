using CodexNative.Core;
using System.Text.Json;
using System.Threading.Channels;

namespace CodexNative.SpeechHost;

internal sealed class SpeechHostApplication : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false,
    };

    private readonly SpeechSessionStateMachine _lifecycle = new();
    private readonly SpeechAudioCapture _capture = new();
    private readonly WhisperSpeechRecognizer _recognizer = new();
    private readonly Channel<SpeechHostEvent> _events = Channel.CreateUnbounded<SpeechHostEvent>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
    private readonly CancellationTokenSource _shutdown = new();
    private CancellationTokenSource? _operationCancellation;
    private string? _referenceText;
    private string? _captureOutputPath;

    private SpeechHostApplication()
    {
        _capture.LevelChanged += level => Emit(new SpeechHostEvent(
            "level",
            _lifecycle.OperationId,
            _lifecycle.Stage,
            Level: level));
    }

    public static async Task<int> RunAsync()
    {
        await using var app = new SpeechHostApplication();
        return await app.RunLoopAsync();
    }

    private async Task<int> RunLoopAsync()
    {
        var writer = WriteEventsAsync(_shutdown.Token);
        Emit(new SpeechHostEvent("ready", Stage: SpeechStage.Idle));
        try
        {
            while (!_shutdown.IsCancellationRequested)
            {
                var line = await Console.In.ReadLineAsync(_shutdown.Token);
                if (line is null) break;
                SpeechHostCommand? command;
                try
                {
                    command = JsonSerializer.Deserialize<SpeechHostCommand>(line, JsonOptions);
                }
                catch (JsonException ex)
                {
                    Emit(new SpeechHostEvent("error", Error: $"Invalid speech command: {ex.Message}"));
                    continue;
                }
                if (command is null) continue;
                _ = HandleCommandAsync(command);
            }
            return 0;
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            return 0;
        }
        finally
        {
            _events.Writer.TryComplete();
            try { await writer; } catch { }
        }
    }

    private async Task HandleCommandAsync(SpeechHostCommand command)
    {
        try
        {
            switch (command.Type)
            {
                case "list_devices":
                    Emit(new SpeechHostEvent("devices", Devices: _capture.ListDevices()));
                    break;
                case "ensure_model":
                    await EnsureModelAsync(command);
                    break;
                case "start":
                    StartCapture(command);
                    break;
                case "stop":
                    StopCapture(command);
                    break;
                case "transcribe_file":
                    await TranscribeFileAsync(command);
                    break;
                case "cancel":
                    Cancel(command.OperationId);
                    break;
                case "shutdown":
                    Cancel();
                    _shutdown.Cancel();
                    break;
                default:
                    Emit(new SpeechHostEvent("error", command.OperationId, Error: $"Unknown speech command '{command.Type}'."));
                    break;
            }
        }
        catch (OperationCanceledException)
        {
            Cancel(command.OperationId);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            var operationId = command.OperationId ?? _lifecycle.OperationId;
            FailAndReset(operationId, ex.Message);
        }
    }

    private async Task EnsureModelAsync(SpeechHostCommand command)
    {
        var operationId = command.OperationId ?? $"model-{Guid.NewGuid():N}";
        if (!_lifecycle.TryBeginDownload(operationId))
            throw new InvalidOperationException("Speech is already recording or processing.");
        _operationCancellation = CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token);
        Emit(new SpeechHostEvent("state", operationId, SpeechStage.Downloading));
        await _recognizer.EnsureModelsAsync(
            progress =>
            {
                Emit(new SpeechHostEvent("download_progress", operationId, SpeechStage.Downloading, Progress: progress));
                return Task.CompletedTask;
            },
            _operationCancellation.Token);
        _lifecycle.TryComplete(operationId);
        Emit(new SpeechHostEvent("model_ready", operationId, SpeechStage.Idle));
        ClearOperationCancellation();
    }

    private void StartCapture(SpeechHostCommand command)
    {
        var operationId = command.OperationId ?? throw new InvalidOperationException("A speech operation id is required.");
        if (!_lifecycle.TryStart(operationId))
            throw new InvalidOperationException("Speech is already recording or processing.");
        _referenceText = command.ReferenceText;
        _captureOutputPath = ValidateAudioPath(command.AudioPath, output: true);
        _operationCancellation = CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token);
        try
        {
            _capture.Start(command.DeviceId);
            Emit(new SpeechHostEvent("state", operationId, SpeechStage.Recording));
            _ = _recognizer.EnsureModelsAsync(
                progress =>
                {
                    Emit(new SpeechHostEvent("download_progress", operationId, SpeechStage.Recording, Progress: progress));
                    return Task.CompletedTask;
                },
                _operationCancellation.Token);
        }
        catch
        {
            _lifecycle.TryCancel(operationId);
            ClearOperationCancellation();
            throw;
        }
    }

    private void StopCapture(SpeechHostCommand command)
    {
        var operationId = command.OperationId ?? throw new InvalidOperationException("A speech operation id is required.");
        if (!_lifecycle.TryBeginTranscription(operationId))
            throw new InvalidOperationException("That speech operation is not recording.");
        var recording = _capture.Stop();
        if (_captureOutputPath is not null)
            SpeechWaveFile.WritePcm16Mono(
                _captureOutputPath,
                recording.Samples,
                SpeechAudioCapture.SampleRate);
        Emit(new SpeechHostEvent("state", operationId, SpeechStage.Transcribing, Metrics: recording.Metrics));
        _ = CompleteTranscriptionAsync(operationId, recording);
    }

    private async Task TranscribeFileAsync(SpeechHostCommand command)
    {
        var operationId = command.OperationId ?? throw new InvalidOperationException("A speech operation id is required.");
        if (!_lifecycle.TryBeginFileTranscription(operationId))
            throw new InvalidOperationException("Speech is already recording or processing.");
        var path = ValidateAudioPath(command.AudioPath, output: false)
            ?? throw new InvalidOperationException("A speech WAV path is required.");
        _referenceText = command.ReferenceText;
        _operationCancellation = CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token);
        Emit(new SpeechHostEvent("state", operationId, SpeechStage.Transcribing));
        var samples = await Task.Run(
            () => SpeechWaveFile.ReadMono(path, SpeechAudioCapture.SampleRate),
            _operationCancellation.Token);
        var recording = new SpeechCapture(
            samples,
            SpeechCaptureAnalysis.Analyze(samples, SpeechAudioCapture.SampleRate, startLatencyMs: 0));
        await CompleteTranscriptionAsync(operationId, recording);
    }

    private async Task CompleteTranscriptionAsync(string operationId, SpeechCapture recording)
    {
        try
        {
            var cancellationToken = _operationCancellation?.Token ?? _shutdown.Token;
            var text = await _recognizer.TranscribeAsync(recording.Samples, cancellationToken);
            SpeechParityResult? parity = null;
            if (!string.IsNullOrWhiteSpace(_referenceText))
                parity = SpeechParityEvaluator.Evaluate(recording.Metrics, text, _referenceText);
            if (!_lifecycle.TryComplete(operationId)) return;
            Emit(new SpeechHostEvent(
                "result",
                operationId,
                SpeechStage.Idle,
                Text: text,
                Metrics: recording.Metrics,
                Parity: parity));
        }
        catch (OperationCanceledException)
        {
            _lifecycle.TryCancel(operationId);
            Emit(new SpeechHostEvent("cancelled", operationId, SpeechStage.Idle));
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            _lifecycle.TryFail(operationId, ex.Message);
            Emit(new SpeechHostEvent("error", operationId, SpeechStage.Failed, Error: ex.Message));
            _lifecycle.TryCancel(operationId);
        }
        finally
        {
            _referenceText = null;
            _captureOutputPath = null;
            ClearOperationCancellation();
        }
    }

    private void Cancel(string? operationId = null)
    {
        _operationCancellation?.Cancel();
        _capture.Cancel();
        if (_lifecycle.TryCancel(operationId))
            Emit(new SpeechHostEvent("cancelled", operationId, SpeechStage.Idle));
        _referenceText = null;
        _captureOutputPath = null;
        ClearOperationCancellation();
    }

    private void FailAndReset(string? operationId, string error)
    {
        if (operationId is null)
        {
            Emit(new SpeechHostEvent("error", Error: error));
            return;
        }
        _capture.Cancel();
        _lifecycle.TryFail(operationId, error);
        Emit(new SpeechHostEvent("error", operationId, SpeechStage.Failed, Error: error));
        _lifecycle.TryCancel(operationId);
        _referenceText = null;
        _captureOutputPath = null;
        ClearOperationCancellation();
    }

    private static string? ValidateAudioPath(string? path, bool output)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        if (!Path.IsPathFullyQualified(path))
            throw new InvalidOperationException("Speech audio paths must be absolute.");
        if (!path.EndsWith(".wav", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Speech audio paths must use a .wav extension.");
        var fullPath = Path.GetFullPath(path);
        if (!output && !File.Exists(fullPath))
            throw new FileNotFoundException("The speech WAV fixture does not exist.", fullPath);
        return fullPath;
    }

    private void Emit(SpeechHostEvent message) => _events.Writer.TryWrite(message);

    private async Task WriteEventsAsync(CancellationToken cancellationToken)
    {
        await foreach (var message in _events.Reader.ReadAllAsync(cancellationToken))
        {
            await Console.Out.WriteLineAsync(JsonSerializer.Serialize(message, JsonOptions));
            await Console.Out.FlushAsync(cancellationToken);
        }
    }

    private void ClearOperationCancellation()
    {
        var cancellation = Interlocked.Exchange(ref _operationCancellation, null);
        cancellation?.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        _shutdown.Cancel();
        _capture.Dispose();
        await _recognizer.DisposeAsync();
        _shutdown.Dispose();
        ClearOperationCancellation();
    }
}
