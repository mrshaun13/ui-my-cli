using System.Security.Cryptography;
using System.Text;
using Whisper.net;
using Whisper.net.Ggml;

namespace CodexNative.SpeechHost;

internal sealed class WhisperSpeechRecognizer : IAsyncDisposable
{
    private const string BaseModelName = "ggml-base.en.bin";
    private const string VadModelName = "ggml-silero-v6.2.0.bin";
    private const string BaseModelSha256 = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
    private const long BaseModelBytes = 147964211;
    private const string VadModelSha256 = "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987";
    private const long VadModelBytes = 885098;
    private readonly SemaphoreSlim _modelGate = new(1, 1);
    private readonly string _modelDirectory;
    private WhisperFactory? _factory;
    private WhisperVadFactory? _vadFactory;

    public WhisperSpeechRecognizer()
    {
        _modelDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CodexNative",
            "speech-models");
    }

    public async Task EnsureModelsAsync(
        Func<double, Task>? progress = null,
        CancellationToken cancellationToken = default)
    {
        await _modelGate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(_modelDirectory);
            var basePath = Path.Combine(_modelDirectory, BaseModelName);
            if (!await HasExpectedSha256Async(basePath, BaseModelSha256, cancellationToken))
            {
                await DownloadAsync(
                    basePath,
                    token => WhisperGgmlDownloader.Default.GetGgmlModelAsync(GgmlType.BaseEn, cancellationToken: token),
                    BaseModelBytes,
                    progress,
                    cancellationToken);
                if (!await HasExpectedSha256Async(basePath, BaseModelSha256, cancellationToken))
                    throw new InvalidDataException("The downloaded Whisper base.en model failed checksum verification.");
            }

            var vadPath = Path.Combine(_modelDirectory, VadModelName);
            if (!await HasExpectedSha256Async(vadPath, VadModelSha256, cancellationToken))
            {
                await DownloadAsync(
                    vadPath,
                    token => WhisperGgmlDownloader.Default.GetGgmlSileroVadModelAsync(cancellationToken: token),
                    expectedBytes: VadModelBytes,
                    progress: null,
                    cancellationToken);
                if (!await HasExpectedSha256Async(vadPath, VadModelSha256, cancellationToken))
                    throw new InvalidDataException("The downloaded Silero VAD model failed checksum verification.");
            }

            _factory ??= WhisperFactory.FromPath(basePath);
            _vadFactory ??= WhisperVadFactory.FromPath(vadPath);
        }
        finally
        {
            _modelGate.Release();
        }
    }

    public async Task<string> TranscribeAsync(float[] samples, CancellationToken cancellationToken)
    {
        await EnsureModelsAsync(cancellationToken: cancellationToken);
        if (samples.Length == 0) return string.Empty;

        using var vad = _vadFactory!.CreateBuilder()
            .WithThreshold(0.5f)
            .Build();
        var speech = await vad.DetectSpeechAsync(samples, cancellationToken);
        if (speech.Count == 0) return string.Empty;

        const int preRollSamples = SpeechAudioCapture.SampleRate * 150 / 1000;
        const int hangoverSamples = SpeechAudioCapture.SampleRate * 350 / 1000;
        var first = Math.Max(0, (int)(speech[0].Start.TotalSeconds * SpeechAudioCapture.SampleRate) - preRollSamples);
        var last = Math.Min(
            samples.Length,
            (int)(speech[^1].End.TotalSeconds * SpeechAudioCapture.SampleRate) + hangoverSamples);
        if (last <= first) return string.Empty;

        using var processor = _factory!.CreateBuilder()
            .WithLanguage("en")
            .WithPrompt("Codex, OpenAI, Kubernetes, OpenShift, GitHub, Avalonia, terminal, repository")
            .Build();
        var text = new StringBuilder();
        await foreach (var segment in processor.ProcessAsync(
                           samples.AsMemory(first, last - first),
                           cancellationToken))
            text.Append(segment.Text);
        return text.ToString().Trim();
    }

    private static async Task DownloadAsync(
        string targetPath,
        Func<CancellationToken, Task<Stream>> openStream,
        long? expectedBytes,
        Func<double, Task>? progress,
        CancellationToken cancellationToken)
    {
        var temporaryPath = $"{targetPath}.{Environment.ProcessId}.partial";
        try
        {
            await using var source = await openStream(cancellationToken);
            await using (var target = new FileStream(
                             temporaryPath,
                             FileMode.Create,
                             FileAccess.Write,
                             FileShare.None,
                             bufferSize: 1024 * 128,
                             useAsync: true))
            {
                var buffer = new byte[1024 * 128];
                long written = 0;
                var lastReportedProgress = -1d;
                while (true)
                {
                    var read = await source.ReadAsync(buffer, cancellationToken);
                    if (read == 0) break;
                    await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                    written += read;
                    if (progress is not null && expectedBytes is > 0)
                    {
                        var currentProgress = Math.Clamp(written / (double)expectedBytes.Value, 0, 1);
                        if (currentProgress >= 1 || currentProgress - lastReportedProgress >= 0.01)
                        {
                            lastReportedProgress = currentProgress;
                            await progress(currentProgress);
                        }
                    }
                }
                await target.FlushAsync(cancellationToken);
            }

            // Windows does not allow replacing a file while this process still
            // owns the temporary file handle. Keep the atomic rename outside the
            // FileStream scope so first-run model installation behaves the same
            // on Windows and Unix.
            File.Move(temporaryPath, targetPath, true);
        }
        finally
        {
            try { File.Delete(temporaryPath); } catch { }
        }
    }

    private static async Task<bool> HasExpectedSha256Async(
        string path,
        string expected,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return false;
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexStringLower(hash).Equals(expected, StringComparison.Ordinal);
    }

    public async ValueTask DisposeAsync()
    {
        await _modelGate.WaitAsync();
        try
        {
            _vadFactory?.Dispose();
            _factory?.Dispose();
            _vadFactory = null;
            _factory = null;
        }
        finally
        {
            _modelGate.Release();
            _modelGate.Dispose();
        }
    }
}
