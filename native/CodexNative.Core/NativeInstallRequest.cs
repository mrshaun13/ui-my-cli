namespace CodexNative.Core;

public sealed record NativeInstallRequest(
    int ParentProcessId,
    NativePlatform Platform,
    string SourcePayload,
    string TargetDirectory,
    IReadOnlyList<int>? RelatedProcessIds = null)
{
    public static NativeInstallRequest Parse(IReadOnlyList<string> arguments)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < arguments.Count; index += 2)
        {
            if (index + 1 >= arguments.Count || !arguments[index].StartsWith("--", StringComparison.Ordinal))
                throw new ArgumentException("Updater arguments must be name/value pairs.", nameof(arguments));
            if (!values.TryAdd(arguments[index], arguments[index + 1]))
                throw new ArgumentException($"Duplicate updater argument: {arguments[index]}", nameof(arguments));
        }
        var expectedNames = new[] { "--parent-pid", "--platform", "--source", "--target", "--wait-pids" };
        if (values.Count is < 4 or > 5 || values.Keys.Any(name => !expectedNames.Contains(name, StringComparer.Ordinal)))
            throw new ArgumentException("Updater received an unknown or incomplete argument set.", nameof(arguments));

        if (!int.TryParse(Required(values, "--parent-pid"), out var parentPid) || parentPid <= 0)
            throw new ArgumentException("Updater parent PID is invalid.", nameof(arguments));
        var platform = Required(values, "--platform") switch
        {
            "windows" => NativePlatform.Windows,
            "macos" => NativePlatform.MacOS,
            _ => throw new ArgumentException("Updater platform is invalid.", nameof(arguments)),
        };
        var source = ValidateDirectoryPath(Required(values, "--source"), "source");
        var target = ValidateDirectoryPath(Required(values, "--target"), "target");
        if (source.Equals(target, PathComparison))
            throw new ArgumentException("Updater source and target must differ.", nameof(arguments));
        if (Path.GetPathRoot(target)?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .Equals(target.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), PathComparison) == true)
            throw new ArgumentException("Updater target cannot be a filesystem root.", nameof(arguments));

        var relatedProcessIds = values.TryGetValue("--wait-pids", out var waitPids)
            ? ParseProcessIds(waitPids, parentPid)
            : null;

        return new NativeInstallRequest(parentPid, platform, source, target, relatedProcessIds);
    }

    public IReadOnlyList<string> ToArguments()
    {
        var arguments = new List<string>
        {
            "--parent-pid", ParentProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "--platform", Platform == NativePlatform.Windows ? "windows" : "macos",
            "--source", SourcePayload,
            "--target", TargetDirectory,
        };
        var related = RelatedProcessIds?
            .Where(processId => processId > 0 && processId != ParentProcessId)
            .Distinct()
            .Take(MaximumRelatedProcesses)
            .ToArray();
        if (related is { Length: > 0 })
        {
            arguments.Add("--wait-pids");
            arguments.Add(string.Join(',', related));
        }
        return arguments;
    }

    private const int MaximumRelatedProcesses = 64;

    private static IReadOnlyList<int> ParseProcessIds(string value, int parentPid)
    {
        var fields = value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (fields.Length is 0 or > MaximumRelatedProcesses)
            throw new ArgumentException("Updater related process list is invalid.");
        var processIds = new List<int>(fields.Length);
        foreach (var field in fields)
        {
            if (!int.TryParse(field, out var processId) || processId <= 0 || processId == parentPid)
                throw new ArgumentException("Updater related process list is invalid.");
            if (!processIds.Contains(processId)) processIds.Add(processId);
        }
        return processIds;
    }

    private static string Required(IReadOnlyDictionary<string, string> values, string name) =>
        values.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new ArgumentException($"Missing updater argument: {name}");

    private static string ValidateDirectoryPath(string path, string label)
    {
        if (!Path.IsPathFullyQualified(path) || path.Any(char.IsControl))
            throw new ArgumentException($"Updater {label} path must be absolute and contain no control characters.");
        return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static StringComparison PathComparison => OperatingSystem.IsWindows()
        ? StringComparison.OrdinalIgnoreCase
        : StringComparison.Ordinal;
}

public static class NativeInstallLayout
{
    public static string FindCurrentInstallDirectory(
        NativePlatform platform,
        string applicationBaseDirectory)
    {
        var baseDirectory = Path.GetFullPath(applicationBaseDirectory)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (platform == NativePlatform.Windows) return baseDirectory;

        var macOs = new DirectoryInfo(baseDirectory);
        if (!macOs.Name.Equals("MacOS", StringComparison.Ordinal)
            || macOs.Parent?.Name != "Contents"
            || macOs.Parent.Parent is not { } app
            || !app.Name.EndsWith(".app", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The macOS update can run only from a packaged .app bundle.");
        return app.FullName;
    }
}
