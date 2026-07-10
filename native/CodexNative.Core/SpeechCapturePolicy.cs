namespace CodexNative.Core;

public static class SpeechCapturePolicy
{
    public const int MaximumDurationSeconds = 120;

    public static int MaximumSampleCount(int sampleRate)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(sampleRate);
        return checked(sampleRate * MaximumDurationSeconds);
    }
}

public sealed class SpeechSampleBuffer
{
    private readonly List<float> _samples = [];

    public SpeechSampleBuffer(int maximumSampleCount)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maximumSampleCount);
        MaximumSampleCount = maximumSampleCount;
    }

    public int Count => _samples.Count;
    public int MaximumSampleCount { get; }
    public bool IsFull => Count >= MaximumSampleCount;

    public bool Append(ReadOnlySpan<float> samples)
    {
        if (IsFull) return false;
        var accepted = Math.Min(samples.Length, MaximumSampleCount - Count);
        for (var index = 0; index < accepted; index++) _samples.Add(samples[index]);
        return IsFull;
    }

    public float[] Drain()
    {
        var samples = _samples.ToArray();
        _samples.Clear();
        return samples;
    }

    public void Clear() => _samples.Clear();
}
