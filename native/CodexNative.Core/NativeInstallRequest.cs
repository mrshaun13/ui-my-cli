namespace CodexNative.Core;

public sealed record NativeInstallRequest(
    int ParentProcessId,
    NativePlatform Platform,
    string SourcePayload,
    string TargetDirectory,
    IReadOnlyList<int>? RelatedProcessIds = null,
    int? DashboardServiceProcessId = null,
    long? DashboardServiceStartTimeUnixMilliseconds = null,
    string? DashboardEndpoint = null,
    string? DashboardInstanceId = null,
    string? DashboardControlCapability = null)
{
    public static NativeInstallRequest Parse(
        IReadOnlyList<string> arguments,
        string? dashboardControlCapability = null)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < arguments.Count; index += 2)
        {
            if (index + 1 >= arguments.Count || !arguments[index].StartsWith("--", StringComparison.Ordinal))
                throw new ArgumentException("Updater arguments must be name/value pairs.", nameof(arguments));
            if (!values.TryAdd(arguments[index], arguments[index + 1]))
                throw new ArgumentException($"Duplicate updater argument: {arguments[index]}", nameof(arguments));
        }
        var expectedNames = new[]
        {
            "--parent-pid", "--platform", "--source", "--target", "--wait-pids",
            "--dashboard-service-pid", "--dashboard-service-start-time", "--dashboard-endpoint", "--dashboard-instance-id",
        };
        if (values.Count is < 4 or > 9 || values.Keys.Any(name => !expectedNames.Contains(name, StringComparer.Ordinal)))
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

        var dashboardArgumentCount = new[]
        {
            "--dashboard-service-pid", "--dashboard-service-start-time", "--dashboard-endpoint", "--dashboard-instance-id",
        }.Count(values.ContainsKey);
        if (dashboardArgumentCount is not 0 and not 4)
            throw new ArgumentException("Updater dashboard handoff arguments must be supplied together.", nameof(arguments));
        int? dashboardServiceProcessId = null;
        long? dashboardServiceStartTime = null;
        string? dashboardEndpoint = null;
        string? dashboardInstanceId = null;
        if (dashboardArgumentCount == 4)
        {
            if (!int.TryParse(Required(values, "--dashboard-service-pid"), out var servicePid)
                || servicePid <= 0
                || servicePid == parentPid
                || relatedProcessIds?.Contains(servicePid) == true)
                throw new ArgumentException("Updater dashboard service PID is invalid.", nameof(arguments));
            if (!long.TryParse(
                    Required(values, "--dashboard-service-start-time"),
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var serviceStartTime)
                || serviceStartTime <= 0)
                throw new ArgumentException("Updater dashboard service start time is invalid.", nameof(arguments));
            if (!DashboardServiceOwnership.IsValidControlCapability(dashboardControlCapability))
                throw new ArgumentException("Updater dashboard control capability is invalid.", nameof(dashboardControlCapability));
            dashboardServiceProcessId = servicePid;
            dashboardServiceStartTime = serviceStartTime;
            dashboardEndpoint = ValidateDashboardEndpoint(Required(values, "--dashboard-endpoint"));
            dashboardInstanceId = ValidateInstanceId(Required(values, "--dashboard-instance-id"));
        }

        return new NativeInstallRequest(
            parentPid,
            platform,
            source,
            target,
            relatedProcessIds,
            dashboardServiceProcessId,
            dashboardServiceStartTime,
            dashboardEndpoint,
            dashboardInstanceId,
            dashboardControlCapability);
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
        var dashboardFields = new object?[]
        {
            DashboardServiceProcessId, DashboardServiceStartTimeUnixMilliseconds,
            DashboardEndpoint, DashboardInstanceId, DashboardControlCapability,
        };
        if (dashboardFields.Any(value => value is not null)
            && dashboardFields.Any(value => value is null))
            throw new InvalidOperationException("Updater dashboard handoff values must be supplied together.");
        if (DashboardServiceProcessId is { } servicePid)
        {
            if (servicePid <= 0 || servicePid == ParentProcessId || related?.Contains(servicePid) == true)
                throw new InvalidOperationException("Updater dashboard service PID is invalid.");
            if (!DashboardServiceOwnership.IsValidControlCapability(DashboardControlCapability))
                throw new InvalidOperationException("Updater dashboard control capability is invalid.");
            arguments.Add("--dashboard-service-pid");
            arguments.Add(servicePid.ToString(System.Globalization.CultureInfo.InvariantCulture));
            if (DashboardServiceStartTimeUnixMilliseconds is not { } serviceStartTime
                || serviceStartTime <= 0)
                throw new InvalidOperationException("Updater dashboard service start time is invalid.");
            arguments.Add("--dashboard-service-start-time");
            arguments.Add(serviceStartTime.ToString(
                System.Globalization.CultureInfo.InvariantCulture));
            arguments.Add("--dashboard-endpoint");
            arguments.Add(ValidateDashboardEndpoint(DashboardEndpoint!));
            arguments.Add("--dashboard-instance-id");
            arguments.Add(ValidateInstanceId(DashboardInstanceId!));
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

    private static string ValidateDashboardEndpoint(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var endpoint)
            || endpoint.Scheme != Uri.UriSchemeHttp
            || endpoint.Host is not ("127.0.0.1" or "localhost")
            || !string.IsNullOrEmpty(endpoint.UserInfo)
            || !string.IsNullOrEmpty(endpoint.Query)
            || !string.IsNullOrEmpty(endpoint.Fragment)
            || !DashboardServicePorts.IsPrivateCandidate(endpoint.Port)
            || endpoint.AbsolutePath.TrimEnd('/') != "/api")
            throw new ArgumentException("Updater dashboard endpoint must be a private HTTP loopback /api URL.");
        return new UriBuilder(endpoint) { Path = "/api/" }.Uri.AbsoluteUri;
    }

    private static string ValidateInstanceId(string value) =>
        Guid.TryParseExact(value, "D", out var parsed)
            ? parsed.ToString("D")
            : throw new ArgumentException("Updater dashboard instance ID is invalid.");

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
