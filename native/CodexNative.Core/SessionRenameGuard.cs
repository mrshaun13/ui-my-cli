namespace CodexNative.Core;

public readonly record struct PendingSessionRename(string ExpectedTitle, DateTimeOffset ExpiresAt);

public static class SessionRenameGuard
{
    public static bool IsActive(PendingSessionRename pending, DateTimeOffset now) =>
        now < pending.ExpiresAt;

    public static string ResolveTitle(
        string incomingTitle,
        PendingSessionRename pending,
        DateTimeOffset now) =>
        IsActive(pending, now) ? pending.ExpectedTitle : incomingTitle;
}
