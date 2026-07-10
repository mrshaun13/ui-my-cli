using CodexNative.Core;
using SoundFlow.Abstracts;
using SoundFlow.Abstracts.Devices;
using SoundFlow.Backends.MiniAudio;
using SoundFlow.Components;
using SoundFlow.Enums;
using SoundFlow.Structs;
using System.Diagnostics;

namespace CodexNative.SpeechHost;

internal sealed class SpeechAudioCapture : IDisposable
{
    public const int SampleRate = 16000;
    private static readonly AudioFormat CaptureFormat = new()
    {
        SampleRate = SampleRate,
        Channels = 1,
        Format = SampleFormat.F32,
        Layout = ChannelLayout.Mono,
    };

    private readonly object _gate = new();
    private readonly MiniAudioEngine _engine = new();
    private readonly SpeechSampleBuffer _samples = new(
        SpeechCapturePolicy.MaximumSampleCount(SampleRate));
    private AudioCaptureDevice? _device;
    private Recorder? _recorder;
    private Timer? _maximumDurationTimer;
    private long _captureRequestedAt;
    private long _firstSamplesAt;
    private long _lastLevelAt;
    private string? _operationId;
    private bool _recording;

    public event Action<string, float>? LevelChanged;
    public event Action<string>? MaximumDurationReached;

    public IReadOnlyList<SpeechInputDevice> ListDevices()
    {
        _engine.UpdateAudioDevicesInfo();
        return _engine.CaptureDevices
            .Select(device => new SpeechInputDevice(device.Name, device.Name, device.IsDefault))
            .ToList();
    }

    public void Start(string operationId, string? requestedDevice)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operationId);
        lock (_gate)
        {
            if (_recording) throw new InvalidOperationException("A microphone recording is already active.");
            CleanupCapture();
            _engine.UpdateAudioDevicesInfo();
            var selected = string.IsNullOrWhiteSpace(requestedDevice)
                ? _engine.CaptureDevices.FirstOrDefault(device => device.IsDefault)
                : _engine.CaptureDevices.FirstOrDefault(device => device.Name == requestedDevice);
            if (string.IsNullOrWhiteSpace(selected.Name))
                selected = _engine.CaptureDevices.FirstOrDefault();
            if (string.IsNullOrWhiteSpace(selected.Name))
                throw new InvalidOperationException("No microphone input device is available.");

            _samples.Clear();
            _captureRequestedAt = Stopwatch.GetTimestamp();
            _firstSamplesAt = 0;
            _lastLevelAt = 0;
            _operationId = operationId;
            try
            {
                _device = _engine.InitializeCaptureDevice(selected, CaptureFormat);
                _recorder = new Recorder(_device, OnAudioProcessed);
                var result = _recorder.StartRecording();
                if (!result.IsSuccess)
                    throw new InvalidOperationException(result.Error?.Message ?? "Could not start microphone recording.");
                _recording = true;
                _device.Start();
                _maximumDurationTimer = new Timer(
                    _ => MaximumDurationReached?.Invoke(operationId),
                    null,
                    TimeSpan.FromSeconds(SpeechCapturePolicy.MaximumDurationSeconds),
                    Timeout.InfiniteTimeSpan);
            }
            catch
            {
                CleanupCapture();
                _operationId = null;
                throw;
            }
        }
    }

    public SpeechCapture Stop()
    {
        AudioCaptureDevice? device;
        Recorder? recorder;
        Timer? maximumDurationTimer;
        lock (_gate)
        {
            if (!_recording) throw new InvalidOperationException("No microphone recording is active.");
            _recording = false;
            _operationId = null;
            (device, recorder) = DetachCaptureLocked();
            maximumDurationTimer = DetachMaximumDurationTimerLocked();
        }

        maximumDurationTimer?.Dispose();
        try { device?.Stop(); } catch { }
        try { recorder?.StopRecording(); } catch { }
        try
        {
            lock (_gate)
            {
                var samples = _samples.Drain();
                var startLatency = _firstSamplesAt == 0
                    ? 0
                    : Stopwatch.GetElapsedTime(_captureRequestedAt, _firstSamplesAt).TotalMilliseconds;
                var metrics = SpeechCaptureAnalysis.Analyze(samples, SampleRate, startLatency);
                return new SpeechCapture(samples, metrics);
            }
        }
        finally
        {
            try { recorder?.Dispose(); } catch { }
            try { device?.Dispose(); } catch { }
        }
    }

    public void Cancel()
    {
        AudioCaptureDevice? device;
        Recorder? recorder;
        Timer? maximumDurationTimer;
        lock (_gate)
        {
            _recording = false;
            _operationId = null;
            _samples.Clear();
            (device, recorder) = DetachCaptureLocked();
            maximumDurationTimer = DetachMaximumDurationTimerLocked();
        }
        maximumDurationTimer?.Dispose();
        try { device?.Stop(); } catch { }
        try { recorder?.StopRecording(); } catch { }
        try { recorder?.Dispose(); } catch { }
        try { device?.Dispose(); } catch { }
    }

    private void OnAudioProcessed(Span<float> samples, Capability capability)
    {
        if (capability != Capability.Record) return;
        string? maximumDurationOperationId = null;
        string? levelOperationId = null;
        float? peak = null;
        lock (_gate)
        {
            if (!_recording) return;
            if (_firstSamplesAt == 0) _firstSamplesAt = Stopwatch.GetTimestamp();
            if (_samples.Append(samples)) maximumDurationOperationId = _operationId;
            var now = Stopwatch.GetTimestamp();
            if (_lastLevelAt == 0 || Stopwatch.GetElapsedTime(_lastLevelAt, now) >= TimeSpan.FromMilliseconds(50))
            {
                _lastLevelAt = now;
                levelOperationId = _operationId;
                peak = 0f;
                for (var index = 0; index < samples.Length; index++)
                    peak = Math.Max(peak.Value, Math.Abs(samples[index]));
            }
        }
        if (levelOperationId is not null && peak is not null)
            LevelChanged?.Invoke(levelOperationId, peak.Value);
        if (maximumDurationOperationId is not null)
            MaximumDurationReached?.Invoke(maximumDurationOperationId);
    }

    private void CleanupCapture()
    {
        var (device, recorder) = DetachCaptureLocked();
        var maximumDurationTimer = DetachMaximumDurationTimerLocked();
        maximumDurationTimer?.Dispose();
        try { recorder?.Dispose(); } catch { }
        try { device?.Dispose(); } catch { }
    }

    private (AudioCaptureDevice? Device, Recorder? Recorder) DetachCaptureLocked()
    {
        var capture = (_device, _recorder);
        _device = null;
        _recorder = null;
        return capture;
    }

    private Timer? DetachMaximumDurationTimerLocked()
    {
        var timer = _maximumDurationTimer;
        _maximumDurationTimer = null;
        return timer;
    }

    public void Dispose()
    {
        Cancel();
        _engine.Dispose();
    }
}

internal sealed record SpeechCapture(float[] Samples, SpeechCaptureMetrics Metrics);
