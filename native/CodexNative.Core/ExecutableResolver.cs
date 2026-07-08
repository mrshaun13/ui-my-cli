namespace CodexNative.Core;

public static class ExecutableResolver
{
    public static string ResolveNode(
        NativePlatform platform,
        string? configuredPath = null,
        string? pathValue = null,
        string? homeDirectory = null,
        Func<string, bool>? isExecutable = null,
        Func<string, IEnumerable<string>>? enumerateDirectories = null)
    {
        isExecutable ??= IsExecutableFile;
        enumerateDirectories ??= Directory.EnumerateDirectories;
        homeDirectory ??= Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(configuredPath)) candidates.Add(configuredPath);

        var executableName = platform == NativePlatform.Windows ? "node.exe" : "node";
        foreach (var directory in (pathValue ?? Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
                     .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            candidates.Add(Path.Combine(directory, executableName));
        }

        if (platform == NativePlatform.MacOS)
        {
            candidates.Add("/opt/homebrew/bin/node");
            candidates.Add("/usr/local/bin/node");
            candidates.Add("/usr/bin/node");
        }
        else if (platform == NativePlatform.Linux)
        {
            candidates.Add("/usr/local/bin/node");
            candidates.Add("/usr/bin/node");
        }

        var nvmRoot = Path.Combine(homeDirectory, ".nvm", "versions", "node");
        try
        {
            candidates.AddRange(enumerateDirectories(nvmRoot)
                .OrderByDescending(path => path, StringComparer.Ordinal)
                .Select(path => Path.Combine(path, "bin", executableName)));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }

        return candidates
            .Where(path => Path.IsPathFullyQualified(path) && !path.Any(char.IsControl))
            .Distinct(StringComparer.Ordinal)
            .FirstOrDefault(isExecutable)
            ?? throw new FileNotFoundException(
                "Node.js was not found. Set NODE_BIN to an absolute executable path or install Node.js in PATH.");
    }

    public static string ResolveLoginShell(
        NativePlatform platform,
        string? configuredShell = null,
        Func<string, bool>? isExecutable = null)
    {
        isExecutable ??= IsExecutableFile;
        var candidates = new[]
        {
            configuredShell,
            platform == NativePlatform.MacOS ? "/bin/zsh" : "/bin/bash",
            "/bin/sh",
        };

        return candidates
            .Where(path => !string.IsNullOrWhiteSpace(path)
                && Path.IsPathFullyQualified(path)
                && !path.Any(char.IsControl))
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .FirstOrDefault(isExecutable)
            ?? throw new FileNotFoundException("No supported local login shell was found.");
    }

    private static bool IsExecutableFile(string path)
    {
        if (!File.Exists(path)) return false;
        if (OperatingSystem.IsWindows()) return true;
        try
        {
            var mode = File.GetUnixFileMode(path);
            return (mode & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) != 0;
        }
        catch (PlatformNotSupportedException)
        {
            return true;
        }
    }
}
