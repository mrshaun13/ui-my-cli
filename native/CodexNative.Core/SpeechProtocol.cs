using System.Text.Json.Serialization;

namespace CodexNative.Core;

[JsonConverter(typeof(JsonStringEnumConverter<SpeechStage>))]
public enum SpeechStage
{
    Idle,
    Recording,
    Transcribing,
    Downloading,
    Failed,
}

public sealed record SpeechHostCommand(
    string Type,
    string? OperationId = null,
    string? DeviceId = null,
    string? Model = null,
    string? AudioPath = null,
    string? ReferenceText = null);

public sealed record SpeechHostEvent(
    string Type,
    string? OperationId = null,
    SpeechStage? Stage = null,
    string? Text = null,
    string? Error = null,
    double? Progress = null,
    float? Level = null,
    SpeechCaptureMetrics? Metrics = null,
    SpeechParityResult? Parity = null,
    IReadOnlyList<SpeechInputDevice>? Devices = null);

public sealed record SpeechInputDevice(string Id, string Name, bool IsDefault);

public sealed record SpeechCaptureMetrics(
    int SampleRate,
    int SampleCount,
    double DurationMs,
    double StartLatencyMs,
    float PeakLevel,
    double ClippedSamplePercent,
    double LeadingSilenceMs,
    double TrailingSilenceMs);

public sealed record SpeechParityThresholds(
    double MaximumStartLatencyMs = 250,
    double MaximumClippedSamplePercent = 1,
    double MaximumWordErrorRate = 0.15);

public sealed record SpeechParityResult(
    bool Passed,
    double WordErrorRate,
    IReadOnlyList<string> Failures);

public sealed class SpeechSessionStateMachine
{
    public SpeechStage Stage { get; private set; } = SpeechStage.Idle;
    public string? OperationId { get; private set; }
    public string? LastError { get; private set; }

    public bool TryStart(string operationId)
    {
        if (Stage != SpeechStage.Idle || string.IsNullOrWhiteSpace(operationId)) return false;
        Stage = SpeechStage.Recording;
        OperationId = operationId;
        LastError = null;
        return true;
    }

    public bool TryBeginTranscription(string operationId)
    {
        if (Stage != SpeechStage.Recording || OperationId != operationId) return false;
        Stage = SpeechStage.Transcribing;
        return true;
    }

    public bool TryBeginFileTranscription(string operationId)
    {
        if (Stage != SpeechStage.Idle || string.IsNullOrWhiteSpace(operationId)) return false;
        Stage = SpeechStage.Transcribing;
        OperationId = operationId;
        LastError = null;
        return true;
    }

    public bool TryBeginDownload(string operationId)
    {
        if (Stage != SpeechStage.Idle || string.IsNullOrWhiteSpace(operationId)) return false;
        Stage = SpeechStage.Downloading;
        OperationId = operationId;
        LastError = null;
        return true;
    }

    public bool TryComplete(string operationId)
    {
        if (OperationId != operationId || Stage is SpeechStage.Idle or SpeechStage.Failed) return false;
        Reset();
        return true;
    }

    public bool TryFail(string operationId, string error)
    {
        if (OperationId != operationId || Stage == SpeechStage.Idle) return false;
        Stage = SpeechStage.Failed;
        LastError = error;
        return true;
    }

    public bool TryCancel(string? operationId = null)
    {
        if (Stage == SpeechStage.Idle || operationId is not null && OperationId != operationId) return false;
        Reset();
        return true;
    }

    private void Reset()
    {
        Stage = SpeechStage.Idle;
        OperationId = null;
        LastError = null;
    }
}

public static class SpeechCaptureAnalysis
{
    private const float VoiceThreshold = 0.015f;
    private const float ClippingThreshold = 0.99f;

    public static SpeechCaptureMetrics Analyze(
        IReadOnlyList<float> samples,
        int sampleRate,
        double startLatencyMs)
    {
        if (sampleRate <= 0) throw new ArgumentOutOfRangeException(nameof(sampleRate));
        var peak = 0f;
        var clipped = 0;
        var firstVoice = -1;
        var lastVoice = -1;
        for (var index = 0; index < samples.Count; index++)
        {
            var level = Math.Abs(samples[index]);
            peak = Math.Max(peak, level);
            if (level >= ClippingThreshold) clipped++;
            if (level < VoiceThreshold) continue;
            if (firstVoice < 0) firstVoice = index;
            lastVoice = index;
        }

        var durationMs = samples.Count * 1000d / sampleRate;
        var leadingSilenceMs = firstVoice < 0 ? durationMs : firstVoice * 1000d / sampleRate;
        var trailingSilenceMs = lastVoice < 0
            ? durationMs
            : Math.Max(0, samples.Count - lastVoice - 1) * 1000d / sampleRate;
        return new SpeechCaptureMetrics(
            sampleRate,
            samples.Count,
            durationMs,
            Math.Max(0, startLatencyMs),
            peak,
            samples.Count == 0 ? 0 : clipped * 100d / samples.Count,
            leadingSilenceMs,
            trailingSilenceMs);
    }
}

public static class SpeechParityEvaluator
{
    public static SpeechParityResult Evaluate(
        SpeechCaptureMetrics metrics,
        string recognizedText,
        string referenceText,
        SpeechParityThresholds? thresholds = null)
    {
        thresholds ??= new SpeechParityThresholds();
        var failures = new List<string>();
        if (metrics.StartLatencyMs > thresholds.MaximumStartLatencyMs)
            failures.Add($"Capture start latency {metrics.StartLatencyMs:0}ms exceeds {thresholds.MaximumStartLatencyMs:0}ms.");
        if (metrics.ClippedSamplePercent > thresholds.MaximumClippedSamplePercent)
            failures.Add($"Clipped samples {metrics.ClippedSamplePercent:0.00}% exceed {thresholds.MaximumClippedSamplePercent:0.00}%.");
        var wordErrorRate = WordErrorRate(recognizedText, referenceText);
        if (wordErrorRate > thresholds.MaximumWordErrorRate)
            failures.Add($"Word error rate {wordErrorRate:P1} exceeds {thresholds.MaximumWordErrorRate:P1}.");
        return new SpeechParityResult(failures.Count == 0, wordErrorRate, failures);
    }

    public static double WordErrorRate(string recognizedText, string referenceText)
    {
        var recognized = Words(recognizedText);
        var reference = Words(referenceText);
        if (reference.Length == 0) return recognized.Length == 0 ? 0 : 1;
        var previous = Enumerable.Range(0, recognized.Length + 1).ToArray();
        for (var row = 1; row <= reference.Length; row++)
        {
            var current = new int[recognized.Length + 1];
            current[0] = row;
            for (var column = 1; column <= recognized.Length; column++)
            {
                var substitution = previous[column - 1]
                    + (reference[row - 1] == recognized[column - 1] ? 0 : 1);
                current[column] = Math.Min(
                    Math.Min(previous[column] + 1, current[column - 1] + 1),
                    substitution);
            }
            previous = current;
        }
        return previous[^1] / (double)reference.Length;
    }

    private static string[] Words(string value) =>
        new string(value
                .ToLowerInvariant()
                .Select(character => char.IsLetterOrDigit(character) || char.IsWhiteSpace(character)
                    ? character
                    : ' ')
                .ToArray())
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
}
