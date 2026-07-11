namespace CodexNative.Core;

public enum DashboardApiProbeState
{
    Unreachable,
    Compatible,
    Incompatible,
}

public sealed record DashboardApiProbeResult(
    DashboardApiProbeState State,
    int? ReportedVersion = null,
    int ActivePtys = 0,
    string? InstanceId = null,
    bool ControlAuthenticated = false)
{
    public bool IsCompatible => State == DashboardApiProbeState.Compatible;

    public bool CanReplaceOwnedService(bool ownsService) =>
        ownsService
        && State == DashboardApiProbeState.Incompatible
        && ActivePtys == 0;

    public static DashboardApiProbeResult FromResponse(
        bool ok,
        int reportedVersion,
        int activePtys = 0,
        string? instanceId = null,
        bool controlAuthenticated = false) =>
        !ok
            ? new(DashboardApiProbeState.Unreachable)
            : new(
                DashboardApiCompatibility.IsCompatible(reportedVersion)
                    ? DashboardApiProbeState.Compatible
                    : DashboardApiProbeState.Incompatible,
                reportedVersion,
                Math.Max(0, activePtys),
                instanceId,
                controlAuthenticated);

    public static DashboardApiProbeResult Unreachable() =>
        new(DashboardApiProbeState.Unreachable);

    public string DescribeMismatch(int port) =>
        $"Dashboard API mismatch on port {port}: native app requires v{DashboardApiCompatibility.RequiredVersion}, " +
        $"but the service reports v{ReportedVersion?.ToString() ?? "unknown"}.";
}

public static class DashboardApiCompatibility
{
    public const int RequiredVersion = 5;

    public static bool IsCompatible(int reportedVersion) => reportedVersion == RequiredVersion;
}
