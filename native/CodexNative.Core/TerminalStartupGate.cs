namespace CodexNative.Core;

/// <summary>
/// Decides when terminal startup output can be revealed after the caller has
/// confirmed an interactive state such as the Codex composer. Safety ceilings
/// prevent a quiet or continuously updating process from remaining hidden.
/// </summary>
public sealed class TerminalStartupGate
{
    public static readonly TimeSpan DefaultMinimumWait = TimeSpan.FromMilliseconds(250);
    public static readonly TimeSpan DefaultQuietPeriod = TimeSpan.FromMilliseconds(450);
    public static readonly TimeSpan DefaultNoOutputMaximumWait = TimeSpan.FromSeconds(10);
    public static readonly TimeSpan DefaultMaximumWait = TimeSpan.FromSeconds(30);

    private readonly DateTimeOffset _startedAt;
    private readonly TimeSpan _minimumWait;
    private readonly TimeSpan _quietPeriod;
    private readonly TimeSpan _noOutputMaximumWait;
    private readonly TimeSpan _maximumWait;
    private DateTimeOffset? _lastOutputAt;

    public TerminalStartupGate(
        DateTimeOffset startedAt,
        TimeSpan? minimumWait = null,
        TimeSpan? quietPeriod = null,
        TimeSpan? noOutputMaximumWait = null,
        TimeSpan? maximumWait = null)
    {
        _startedAt = startedAt;
        _minimumWait = minimumWait ?? DefaultMinimumWait;
        _quietPeriod = quietPeriod ?? DefaultQuietPeriod;
        _noOutputMaximumWait = noOutputMaximumWait ?? DefaultNoOutputMaximumWait;
        _maximumWait = maximumWait ?? DefaultMaximumWait;

        if (_minimumWait < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(minimumWait));
        if (_quietPeriod < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(quietPeriod));
        if (_noOutputMaximumWait < _minimumWait) throw new ArgumentOutOfRangeException(nameof(noOutputMaximumWait));
        if (_maximumWait < _minimumWait) throw new ArgumentOutOfRangeException(nameof(maximumWait));
    }

    public void ObserveOutput(DateTimeOffset observedAt)
    {
        if (observedAt >= _startedAt) _lastOutputAt = observedAt;
    }

    public bool ShouldReveal(DateTimeOffset now, bool terminalReady = false)
    {
        var elapsed = now - _startedAt;
        if (_lastOutputAt is null) return elapsed >= _noOutputMaximumWait;
        if (elapsed >= _maximumWait) return true;
        return terminalReady
            && elapsed >= _minimumWait
            && now - _lastOutputAt.Value >= _quietPeriod;
    }
}
