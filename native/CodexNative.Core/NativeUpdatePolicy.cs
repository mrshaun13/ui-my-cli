namespace CodexNative.Core;

public static class NativeUpdatePolicy
{
    public static int CountBlockingSessions(IEnumerable<(string Status, bool IsHeadless)> sessions) =>
        sessions.Count(session => session.Status.Equals("active", StringComparison.OrdinalIgnoreCase));

    public static bool CanInstall(
        IEnumerable<(string Status, bool IsHeadless)> sessions,
        bool hasRunningLocalShell) =>
        !hasRunningLocalShell && CountBlockingSessions(sessions) == 0;
}
