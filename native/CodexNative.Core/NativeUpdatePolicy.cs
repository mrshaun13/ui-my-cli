namespace CodexNative.Core;

public static class NativeUpdatePolicy
{
    public static TimeSpan DrainTimeout { get; } = TimeSpan.FromMinutes(2);

    public static int CountBlockingSessions(IEnumerable<(string Status, bool IsHeadless)> sessions) =>
        sessions.Count(session => session.Status.Equals("active", StringComparison.OrdinalIgnoreCase));

    public static bool CanInstall(
        IEnumerable<(string Status, bool IsHeadless)> sessions,
        bool hasRunningLocalShell) =>
        !hasRunningLocalShell && CountBlockingSessions(sessions) == 0;

    public static void RequireRollbackBackup(bool hadPreviousInstall, bool backupExists)
    {
        if (hadPreviousInstall && !backupExists)
            throw new InvalidOperationException(
                "The previous installation backup is missing; the failed installation was left in place.");
    }
}
