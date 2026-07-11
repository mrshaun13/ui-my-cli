namespace CodexNative.Core;

public sealed record OwnedDashboardServiceHandoff(
    int ProcessId,
    long ProcessStartTimeUnixMilliseconds,
    string Endpoint,
    string InstanceId,
    string ControlCapability);

public static class NativeDashboardUpdatePolicy
{
    public static async Task RevalidateThenStopAsync(
        string expectedInstanceId,
        Func<CancellationToken, Task<DashboardApiProbeResult>> revalidate,
        Func<CancellationToken, Task> stop,
        CancellationToken cancellationToken = default)
    {
        var probe = await revalidate(cancellationToken);
        RequireDrainedOwnedInstance(expectedInstanceId, probe);
        await stop(cancellationToken);
    }

    public static void RequireDrainedOwnedInstance(
        string expectedInstanceId,
        DashboardApiProbeResult probe)
    {
        if (!probe.IsCompatible)
            throw new InvalidOperationException(
                "The owned dashboard service could not be revalidated; no process was stopped.");
        if (!string.Equals(probe.InstanceId, expectedInstanceId, StringComparison.Ordinal))
            throw new InvalidOperationException(
                "The dashboard service instance changed during update handoff; no process was stopped.");
        if (!probe.ControlAuthenticated)
            throw new InvalidOperationException(
                "The dashboard service rejected the update control capability; no process was stopped.");
        if (!probe.ActivityCheckOk)
            throw new InvalidOperationException(
                "The dashboard service could not verify provider activity; no process was stopped.");
        if (probe.BlockingSessions > 0)
            throw new InvalidOperationException(
                $"The dashboard service has {probe.BlockingSessions} active provider session(s); wait for them to finish and retry the update.");
        if (probe.ActivePtys > 0)
            throw new InvalidOperationException(
                $"The dashboard service has {probe.ActivePtys} active terminal(s); close them and retry the update.");
    }
}
