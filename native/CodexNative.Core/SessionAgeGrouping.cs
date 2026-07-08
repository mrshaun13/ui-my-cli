namespace CodexNative.Core;

public static class SessionAgeGrouping
{
    private const long SecondsPerDay = 86_400;

    public static bool IsCold(
        string? status,
        long lastActivityAt,
        long now,
        int coldDays)
    {
        if (!string.Equals(status, "idle", StringComparison.OrdinalIgnoreCase)) return false;
        var threshold = Math.Max(1, coldDays) * SecondsPerDay;
        return now - lastActivityAt >= threshold;
    }
}
