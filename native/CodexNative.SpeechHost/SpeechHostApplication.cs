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
    private readonly SpeechOperationOwnership<SpeechOperation> _operations = new();
    private readonly object _captureGate = new();

    private SpeechHostApplication()
    {
        _capture.LevelChanged += (operationId, level) => Emit(new SpeechHostEvent(
            "level",
            operationId,
            SpeechStage.Recording,
            Level: level));
        _capture.MaximumDurationReached += QueueMaximumDurationStop;
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
        SpeechOperation operation;
        lock (_captureGate)
        {
            if (!_lifecycle.TryBeginDownload(operationId))
                throw new InvalidOperationException("Speech is already recording or processing.");
            operation = BeginOperation(operationId);
        }
        Emit(new SpeechHostEvent("state", operationId, SpeechStage.Downloading));
        await _recognizer.EnsureModelsAsync(
            progress =>
            {
                Emit(new SpeechHostEvent("download_progress", operationId, SpeechStage.Downloading, Progress: progress));
                return Task.CompletedTask;
            },
            operation.Token);
        if (_lifecycle.TryComplete(operationId))
            Emit(new SpeechHostEvent("model_ready", operationId, SpeechStage.Idle));
        ClearOperation(operation);
    }

    private void StartCapture(SpeechHostCommand command)
    {
        var operationId = command.OperationId ?? throw new InvalidOperationException("A speech operation id is required.");
        var captureOutputPath = ValidateAudioPath(command.AudioPath, output: true);
        lock (_captureGate)
        {
            if (!_lifecycle.TryStart(operationId))
                throw new InvalidOperationException("Speech is already recording or processing.");
            var operation = BeginOperation(
                operationId,
                command.ReferenceText,
                captureOutputPath);
            try
            {
                _capture.Start(operationId, command.DeviceId);
                Emit(new SpeechHostEvent("state", operationId, SpeechStage.Recording));
                _ = _recognizer.EnsureModelsAsync(
                    progress =>
                    {
                        Emit(new SpeechHostEvent("download_progress", operationId, SpeechStage.Recording, Progress: progress));
                        return Task.CompletedTask;
                    },
                    operation.Token);
            }
            catch
            {
                _capture.Cancel();
                _lifecycle.TryCancel(operationId);
                ClearOperation(operation);
                throw;
            }
        }
    }

    private void StopCapture(SpeechHostCommand command)
    {
        var operationId = command.OperationId ?? throw new InvalidOperationException("A speech operation id is required.");
        StopCapture(operationId, expectedOperation: null, ignoreIfNotRecording: false, maximumDurationReached: false);
    }

    private bool StopCapture(
        string operationId,
        SpeechOperation? expectedOperation,
        bool ignoreIfNotRecording,
        bool maximumDurationReached)
    {
        lock (_captureGate)
        {
            var operation = FindOperation(operationId);
            if (operation is null || expectedOperation is not null && !ReferenceEquals(operation, expectedOperation))
            {
                if (ignoreIfNotRecording) return false;
                throw new InvalidOperationException("That speech operation is not active.");
            }
            if (!_lifecycle.TryBeginTranscription(operationId))
            {
                if (ignoreIfNotRecording || _lifecycle.Is(operationId, SpeechStage.Transcribing)) return false;
                throw new InvalidOperationException("That speech operation is not recording.");
            }
            var recording = _capture.Stop();
            if (operation.CaptureOutputPath is not null)
                SpeechWaveFile.WritePcm16Mono(
                    operation.CaptureOutputPath,
                    recording.Samples,
                    SpeechAudioCapture.SampleRate);
            Emit(new SpeechHostEvent("state", operationId, SpeechStage.Transcribing, Metrics: recording.Metrics));
            if (maximumDurationReached)
                Emit(new SpeechHostEvent("capture_limit", operationId, SpeechStage.Transcribing));
            _ = CompleteTranscriptionAsync(operation, recording);
            return true;
        }
    }

    private void QueueMaximumDurationStop(string operationId)
    {
        if (_shutdown.IsCancellationRequested) return;
        var operation = FindOperation(operationId);
        if (operation is not null) _ = Task.Run(() => StopCaptureAtMaximumDuration(operation));
    }

    private void StopCaptureAtMaximumDuration(SpeechOperation operation)
    {
        try
        {
            StopCapture(
                operation.Id,
                operation,
                ignoreIfNotRecording: true,
                maximumDurationReached: true);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            FailAndReset(operation.Id, ex.Message);
        }
    }

    private async Task TranscribeFileAsync(SpeechHostCommand command)
    {
        var operationId = command.OperationId ?? throw new InvalidOperationException("A speech operation id is required.");
        var path = ValidateAudioPath(command.AudioPath, output: false)
            ?? throw new InvalidOperationException("A speech WAV path is required.");
        SpeechOperation operation;
        lock (_captureGate)
        {
            if (!_lifecycle.TryBeginFileTranscription(operationId))
                throw new InvalidOperationException("Speech is already recording or processing.");
            operation = BeginOperation(operationId, command.ReferenceText);
        }
        Emit(new SpeechHostEvent("state", operationId, SpeechStage.Transcribing));
        var samples = await Task.Run(
            () => SpeechWaveFile.ReadMono(path, SpeechAudioCapture.SampleRate),
            operation.Token);
        var recording = new SpeechCapture(
            samples,
            SpeechCaptureAnalysis.Analyze(samples, SpeechAudioCapture.SampleRate, startLatencyMs: 0));
        await CompleteTranscriptionAsync(operation, recording);
    }

    private async Task CompleteTranscriptionAsync(SpeechOperation operation, SpeechCapture recording)
    {
        try
        {
            var text = await _recognizer.TranscribeAsync(recording.Samples, operation.Token);
            SpeechParityResult? parity = null;
            if (!string.IsNullOrWhiteSpace(operation.ReferenceText))
                parity = SpeechParityEvaluator.Evaluate(recording.Metrics, text, operation.ReferenceText);
            if (!_lifecycle.TryComplete(operation.Id)) return;
            Emit(new SpeechHostEvent(
                "result",
                operation.Id,
                SpeechStage.Idle,
                Text: text,
                Metrics: recording.Metrics,
                Parity: parity));
        }
        catch (OperationCanceledException)
        {
            if (_lifecycle.TryCancel(operation.Id))
                Emit(new SpeechHostEvent("cancelled", operation.Id, SpeechStage.Idle));
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            if (_lifecycle.TryFail(operation.Id, ex.Message))
            {
                Emit(new SpeechHostEvent("error", operation.Id, SpeechStage.Failed, Error: ex.Message));
                _lifecycle.TryCancel(operation.Id);
            }
        }
        finally
        {
            ClearOperation(operation);
        }
    }

    private void Cancel(string? operationId = null)
    {
        lock (_captureGate)
        {
            var operation = _operations.Current;
            if (operation is null || operationId is not null && operation.Id != operationId) return;
            try { operation.Cancellation.Cancel(); } catch (ObjectDisposedException) { }
            _capture.Cancel();
            if (_lifecycle.TryCancel(operation.Id))
                Emit(new SpeechHostEvent("cancelled", operation.Id, SpeechStage.Idle));
            ClearOperation(operation);
        }
    }

    private void FailAndReset(string? operationId, string error)
    {
        if (operationId is null)
        {
            Emit(new SpeechHostEvent("error", Error: error));
            return;
        }
        lock (_captureGate)
        {
            var operation = FindOperation(operationId);
            if (operation is null)
            {
                Emit(new SpeechHostEvent("error", operationId, Error: error));
                return;
            }
            _capture.Cancel();
            try { operation.Cancellation.Cancel(); } catch (ObjectDisposedException) { }
            if (_lifecycle.TryFail(operation.Id, error))
            {
                Emit(new SpeechHostEvent("error", operation.Id, SpeechStage.Failed, Error: error));
                _lifecycle.TryCancel(operation.Id);
            }
            ClearOperation(operation);
        }
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

    private SpeechOperation BeginOperation(
        string operationId,
        string? referenceText = null,
        string? captureOutputPath = null)
    {
        var operation = new SpeechOperation(
            operationId,
            CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token),
            referenceText,
            captureOutputPath);
        _operations.Set(operation);
        return operation;
    }

    private SpeechOperation? FindOperation(string operationId)
    {
        var operation = _operations.Current;
        return operation?.Id == operationId ? operation : null;
    }

    private void ClearOperation(SpeechOperation operation)
    {
        _operations.ClearIfCurrent(operation);
        operation.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        _shutdown.Cancel();
        _capture.Dispose();
        await _recognizer.DisposeAsync();
        _shutdown.Dispose();
        var operation = _operations.Clear();
        operation?.Dispose();
    }

    private sealed class SpeechOperation(
        string id,
        CancellationTokenSource cancellation,
        string? referenceText,
        string? captureOutputPath) : IDisposable
    {
        private int _disposed;
        public string Id { get; } = id;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public CancellationToken Token { get; } = cancellation.Token;
        public string? ReferenceText { get; } = referenceText;
        public string? CaptureOutputPath { get; } = captureOutputPath;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0) Cancellation.Dispose();
        }
    }
}
