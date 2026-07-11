namespace CodexNative.Core;

public static class NativeInstallProcessPolicy
{
    public static bool CanTerminateRelatedTerminalHost(
        NativePlatform platform,
        string targetDirectory,
        int processId,
        IReadOnlySet<int> relatedProcessIds,
        string? processExecutable) =>
        relatedProcessIds.Contains(processId)
        && IsOwnedTerminalHost(platform, targetDirectory, processExecutable);

    public static bool IsBlockingInstallProcess(
        NativePlatform platform,
        string targetDirectory,
        int parentProcessId,
        IReadOnlySet<int> relatedProcessIds,
        int processId,
        string? processExecutable)
    {
        if (processId == parentProcessId) return false;
        if (IsMainApplication(platform, targetDirectory, processExecutable)) return true;
        return IsOwnedTerminalHost(platform, targetDirectory, processExecutable)
            && !relatedProcessIds.Contains(processId);
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
}
