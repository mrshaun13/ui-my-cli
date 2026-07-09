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
    private readonly List<float> _samples = [];
    private AudioCaptureDevice? _device;
    private Recorder? _recorder;
    private long _captureRequestedAt;
    private long _firstSamplesAt;
    private long _lastLevelAt;
    private bool _recording;

    public event Action<float>? LevelChanged;

    public IReadOnlyList<SpeechInputDevice> ListDevices()
    {
        _engine.UpdateAudioDevicesInfo();
        return _engine.CaptureDevices
            .Select(device => new SpeechInputDevice(device.Name, device.Name, device.IsDefault))
            .ToList();
    }

    public void Start(string? requestedDevice)
    {
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
            try
            {
                _device = _engine.InitializeCaptureDevice(selected, CaptureFormat);
                _recorder = new Recorder(_device, OnAudioProcessed);
                var result = _recorder.StartRecording();
                if (!result.IsSuccess)
                    throw new InvalidOperationException(result.Error?.Message ?? "Could not start microphone recording.");
                _recording = true;
                _device.Start();
            }
            catch
            {
                CleanupCapture();
                throw;
            }
        }
    }

    public SpeechCapture Stop()
    {
        AudioCaptureDevice? device;
        Recorder? recorder;
        lock (_gate)
        {
            if (!_recording) throw new InvalidOperationException("No microphone recording is active.");
            _recording = false;
            (device, recorder) = DetachCaptureLocked();
        }

        try { device?.Stop(); } catch { }
        try { recorder?.StopRecording(); } catch { }
        try
        {
            lock (_gate)
            {
                var samples = _samples.ToArray();
                var startLatency = _firstSamplesAt == 0
                    ? 0
                    : Stopwatch.GetElapsedTime(_captureRequestedAt, _firstSamplesAt).TotalMilliseconds;
                var metrics = SpeechCaptureAnalysis.Analyze(samples, SampleRate, startLatency);
                _samples.Clear();
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
        lock (_gate)
        {
            _recording = false;
            _samples.Clear();
            (device, recorder) = DetachCaptureLocked();
        }
        try { device?.Stop(); } catch { }
        try { recorder?.StopRecording(); } catch { }
        try { recorder?.Dispose(); } catch { }
        try { device?.Dispose(); } catch { }
    }

    private void OnAudioProcessed(Span<float> samples, Capability capability)
    {
        if (capability != Capability.Record) return;
        lock (_gate)
        {
            if (!_recording) return;
            if (_firstSamplesAt == 0) _firstSamplesAt = Stopwatch.GetTimestamp();
            for (var index = 0; index < samples.Length; index++) _samples.Add(samples[index]);
            var now = Stopwatch.GetTimestamp();
            if (_lastLevelAt != 0 && Stopwatch.GetElapsedTime(_lastLevelAt, now) < TimeSpan.FromMilliseconds(50))
                return;
            _lastLevelAt = now;
            var peak = 0f;
            for (var index = 0; index < samples.Length; index++) peak = Math.Max(peak, Math.Abs(samples[index]));
            LevelChanged?.Invoke(peak);
        }
    }

    private void CleanupCapture()
    {
        var (device, recorder) = DetachCaptureLocked();
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

    public void Dispose()
    {
        Cancel();
        _engine.Dispose();
    }
}

internal sealed record SpeechCapture(float[] Samples, SpeechCaptureMetrics Metrics);
