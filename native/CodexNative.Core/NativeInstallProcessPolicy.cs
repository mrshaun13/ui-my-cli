namespace CodexNative.Core;

public static class NativeInstallProcessPolicy
{
    public static bool IsVerifiedOwnedDashboardService(
        NativePlatform platform,
        string targetDirectory,
        int expectedProcessId,
        int actualProcessId,
        string? processExecutable,
        long expectedStartTimeUnixMilliseconds,
        long actualStartTimeUnixMilliseconds)
    {
        if (expectedProcessId <= 0
            || actualProcessId != expectedProcessId
            || expectedStartTimeUnixMilliseconds <= 0
            || actualStartTimeUnixMilliseconds != expectedStartTimeUnixMilliseconds) return false;
        return platform == NativePlatform.MacOS
            || IsOwnedTerminalHost(platform, targetDirectory, processExecutable);
    }

    public static bool IsOwnedTerminalHost(
        NativePlatform platform,
        string targetDirectory,
        string? processExecutable)
    {
        if (string.IsNullOrWhiteSpace(processExecutable)
            || !Path.IsPathFullyQualified(targetDirectory)
            || !Path.IsPathFullyQualified(processExecutable)) return false;

        var expected = platform == NativePlatform.Windows
            ? Path.Combine(targetDirectory, "CodexNative.TerminalHost.exe")
            : Path.Combine(targetDirectory, "Contents", "MacOS", "CodexNative.TerminalHost");
        var comparison = platform == NativePlatform.Windows
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;
        return Path.GetFullPath(expected).Equals(Path.GetFullPath(processExecutable), comparison);
    }

    public static bool IsMainApplication(
        NativePlatform platform,
        string targetDirectory,
        string? processExecutable)
    {
        if (string.IsNullOrWhiteSpace(processExecutable)
            || !Path.IsPathFullyQualified(targetDirectory)
            || !Path.IsPathFullyQualified(processExecutable)) return false;
        var expected = platform == NativePlatform.Windows
            ? Path.Combine(targetDirectory, "CodexNative.exe")
            : Path.Combine(targetDirectory, "Contents", "MacOS", "CodexNative");
        var comparison = platform == NativePlatform.Windows
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;
        return Path.GetFullPath(expected).Equals(Path.GetFullPath(processExecutable), comparison);
    }

    public static bool IsUpdateBlocker(
        NativePlatform platform,
        string targetDirectory,
        int candidateProcessId,
        string? processExecutable,
        int? ownedDashboardServiceProcessId = null)
    {
        if (candidateProcessId <= 0 || candidateProcessId == ownedDashboardServiceProcessId) return false;
        return IsMainApplication(platform, targetDirectory, processExecutable)
            || IsOwnedTerminalHost(platform, targetDirectory, processExecutable);
    }

}
