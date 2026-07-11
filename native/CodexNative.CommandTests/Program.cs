using CodexNative.Core;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

var failures = new List<string>();
const string host = @"C:\Apps\CodexNative.TerminalHost.exe";
const string dashboardInstanceId = "7e79f66b-b194-45cd-b640-95065d4fb183";
const string dashboardControlCapability = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
const long dashboardServiceStartTime = 1_752_000_000_123;

if (args is ["--verify-release-artifacts", var artifactDirectory, .. var runtimeIdentifiers])
{
    await VerifyReleaseArtifactsAsync(artifactDirectory, runtimeIdentifiers);
    return 0;
}

Check("platform profiles select the correct terminal host and release runtime", () =>
{
    var windows = NativePlatformProfile.For(NativePlatform.Windows);
    Equal(true, windows.UsesWsl);
    Equal("CodexNative.TerminalHost.exe", windows.TerminalHostFileName);
    Equal("CodexNative.SpeechHost.exe", windows.SpeechHostFileName);
    Equal("win-x64", windows.ReleaseRuntimeIdentifier);

    var macArm = NativePlatformProfile.For(
        NativePlatform.MacOS,
        System.Runtime.InteropServices.Architecture.Arm64);
    Equal(false, macArm.UsesWsl);
    Equal("macOS shell", macArm.LocalShellLabel);
    Equal("CodexNative.SpeechHost", macArm.SpeechHostFileName);
    Equal("CodexNative.TerminalHost", macArm.TerminalHostFileName);
    Equal("osx-arm64", macArm.ReleaseRuntimeIdentifier);
});

Check("speech parity WAV fixtures round-trip and resample safely", () =>
{
    var path = Path.Combine(Path.GetTempPath(), $"codex-speech-{Guid.NewGuid():N}.wav");
    try
    {
        var samples = Enumerable.Range(0, 200_000)
            .Select(index => (float)(Math.Sin(index * 2 * Math.PI * 440 / 16000) * 0.4))
            .ToArray();
        SpeechWaveFile.WritePcm16Mono(path, samples, 16000);
        var restored = SpeechWaveFile.ReadMono(path, 8000);
        Equal(100_000, restored.Length);
        Equal(true, restored.Max(value => Math.Abs(value)) is > 0.39f and < 0.41f);
        Throws<ArgumentException>(() => SpeechWaveFile.WritePcm16Mono("relative.wav", samples, 16000));
    }
    finally
    {
        File.Delete(path);
    }
});

Check("conversation search safely handles every prefix of a multi-character query", () =>
{
    const string user = "Review the project scope before implementation.";
    const string assistant = "The unrelated response.";
    foreach (var prefix in new[] { "s", "sc", "sco", "scop", "scope" })
        Equal(true, ConversationSearch.Matches(prefix, user, assistant));
    Equal(false, ConversationSearch.Matches("missing", user, assistant));
    Equal(
        ConversationSearch.MaximumQueryLength,
        ConversationSearch.Normalize(new string('x', ConversationSearch.MaximumQueryLength + 20)).Length);
});

Check("session titles are compacted for constrained native chrome", () =>
{
    Equal("Untitled session", SessionTitleDisplay.Compact(" \r\n\t "));
    Equal(
        "I want to continue a read-only reconciliation between AWS Direct Connect costs and Kentik.",
        SessionTitleDisplay.Compact(
            "I want to continue a read-only reconciliation\r\n\r\n  between AWS Direct Connect costs\n  and Kentik."));

    var compact = SessionTitleDisplay.Compact(new string('x', 200));
    Equal(SessionTitleDisplay.MaximumLength, compact.Length);
    Equal(true, compact.EndsWith('…'));
    Equal(false, compact.Contains('\n'));
});

Check("pending session rename resists stale status titles only during its guard window", () =>
{
    var now = DateTimeOffset.Parse("2026-07-10T12:00:00Z");
    var pending = new PendingSessionRename("New durable title", now.AddSeconds(12));
    Equal("New durable title", SessionRenameGuard.ResolveTitle("Old title", pending, now.AddSeconds(3)));
    Equal("New durable title", SessionRenameGuard.ResolveTitle("New durable title", pending, now.AddSeconds(3)));
    Equal("Another client title", SessionRenameGuard.ResolveTitle("Another client title", pending, now.AddSeconds(12)));
});

Check("rollback requires the previous installation backup before replacement", () =>
{
    NativeUpdatePolicy.RequireRollbackBackup(hadPreviousInstall: true, backupExists: true);
    NativeUpdatePolicy.RequireRollbackBackup(hadPreviousInstall: false, backupExists: false);
    var missing = ThrowsMessage<InvalidOperationException>(() =>
        NativeUpdatePolicy.RequireRollbackBackup(hadPreviousInstall: true, backupExists: false));
    Equal(true, missing.Contains("failed installation was left in place", StringComparison.Ordinal));
});

Check("terminal selection geometry maps and clamps pointer positions", () =>
{
    Equal(new TerminalCell(0, 0), TerminalSelectionGeometry.CellAt(0, 0, 1200, 600, 120, 30));
    Equal(new TerminalCell(60, 15), TerminalSelectionGeometry.CellAt(605, 305, 1200, 600, 120, 30));
    Equal(new TerminalCell(119, 29), TerminalSelectionGeometry.CellAt(2000, 900, 1200, 600, 120, 30));
    Equal(new TerminalCell(0, 0), TerminalSelectionGeometry.CellAt(-20, -10, 1200, 600, 120, 30));
    Throws<ArgumentOutOfRangeException>(() => TerminalSelectionGeometry.CellAt(0, 0, 0, 600, 120, 30));
});

Check("macOS local shell uses a structured env launch without shell interpolation", () =>
{
    var spec = NativeLaunchBuilder.LocalShell(
        NativePlatform.MacOS,
        host,
        "Ubuntu",
        "/Users/tester/a repo",
        "/bin/zsh");
    Equal("/usr/bin/env", spec.Process);
    Equal("/Users/tester/a repo", spec.WorkingDirectory);
    SequenceEqual(
        ["TERM=xterm-256color", "COLORTERM=truecolor", "/bin/zsh", "-l"],
        spec.Arguments);
    Throws<ArgumentException>(() => NativeLaunchBuilder.LocalShell(
        NativePlatform.MacOS,
        host,
        "Ubuntu",
        "relative/path",
        "/bin/zsh"));
});

Check("macOS dashboard service uses structured process settings", () =>
{
    var spec = NativeLaunchBuilder.DashboardService(
        NativePlatform.MacOS,
        host,
        "Ubuntu",
        "/Users/tester/ui-my-cli",
        "/opt/homebrew/bin/node",
        instanceId: dashboardInstanceId);
    Equal("/opt/homebrew/bin/node", spec.Process);
    Equal("/Users/tester/ui-my-cli", spec.WorkingDirectory);
    SequenceEqual(["server/index.js"], spec.Arguments);
    Equal("production", spec.Environment!["NODE_ENV"]);
    Equal("7577", spec.Environment["PORT"]);
    Equal(dashboardInstanceId, spec.Environment["UI_MY_CLI_NATIVE_INSTANCE_ID"]);

    var alternate = NativeLaunchBuilder.DashboardService(
        NativePlatform.MacOS,
        host,
        "Ubuntu",
        "/Users/tester/ui-my-cli",
        "/opt/homebrew/bin/node",
        7584,
        dashboardInstanceId);
    Equal("7584", alternate.Environment!["PORT"]);
});

Check("private dashboard ports are bounded and ordered", () =>
{
    Equal(7575, DashboardServicePorts.Shared);
    Equal(7577, DashboardServicePorts.PrivateCandidates.First());
    Equal(7596, DashboardServicePorts.PrivateCandidates.Last());
    Equal(20, DashboardServicePorts.PrivateCandidates.Count);
    Equal(true, DashboardServicePorts.IsPrivateCandidate(7584));
    Equal(false, DashboardServicePorts.IsPrivateCandidate(7576));
    Equal(false, DashboardServicePorts.IsPrivateCandidate(7597));
});

Check("native updates require an owned private dashboard service", () =>
{
    NativeDashboardUpdatePolicy.RequireOwnedPrivateService(7577, ownsConnectedService: true);
    var shared = ThrowsMessage<InvalidOperationException>(() =>
        NativeDashboardUpdatePolicy.RequireOwnedPrivateService(7575, ownsConnectedService: false));
    Equal(true, shared.Contains("Stop that shared service", StringComparison.Ordinal));
    var unowned = ThrowsMessage<InvalidOperationException>(() =>
        NativeDashboardUpdatePolicy.RequireOwnedPrivateService(7578, ownsConnectedService: false));
    Equal(true, unowned.Contains("does not own", StringComparison.Ordinal));
});

Check("node resolver prefers an explicit executable then PATH", () =>
{
    var available = new HashSet<string>(StringComparer.Ordinal)
    {
        "/custom/node",
        "/path/bin/node",
    };
    var explicitNode = ExecutableResolver.ResolveNode(
        NativePlatform.MacOS,
        "/custom/node",
        "/path/bin",
        "/Users/tester",
        available.Contains,
        _ => []);
    Equal("/custom/node", explicitNode);

    var pathNode = ExecutableResolver.ResolveNode(
        NativePlatform.MacOS,
        null,
        "/path/bin",
        "/Users/tester",
        available.Contains,
        _ => []);
    Equal("/path/bin/node", pathNode);
});

Check("dashboard repository locator finds a checkout above the app artifact", () =>
{
    var files = new HashSet<string>(StringComparer.Ordinal)
    {
        "/Users/tester/ui-my-cli/package.json",
        "/Users/tester/ui-my-cli/server/index.js",
        "/Users/tester/ui-my-cli/node_modules/express/package.json",
        "/Users/tester/ui-my-cli/node_modules/node-pty/package.json",
    };
    var found = DashboardRepositoryLocator.Find(
        "/Users/tester/ui-my-cli/native/artifacts/osx-arm64/CodexNative.app/Contents/MacOS",
        "/Users/tester",
        null,
        files.Contains);
    Equal("/Users/tester/ui-my-cli", found);
});

Check("macOS dashboard repository recovery skips stale checkouts without dependencies", () =>
{
    var files = new HashSet<string>(StringComparer.Ordinal)
    {
        "/Users/tester/old-ui-my-cli/package.json",
        "/Users/tester/old-ui-my-cli/server/index.js",
        "/Users/tester/Desktop/temp/ui-my-cli/package.json",
        "/Users/tester/Desktop/temp/ui-my-cli/server/index.js",
        "/Users/tester/Desktop/temp/ui-my-cli/node_modules/express/package.json",
        "/Users/tester/Desktop/temp/ui-my-cli/node_modules/node-pty/package.json",
    };
    var found = DashboardRepositoryLocator.Find(
        "/Applications/CodexNative.app/Contents/MacOS",
        "/Users/tester",
        "/Users/tester/old-ui-my-cli",
        files.Contains,
        root => root == "/Users/tester/Desktop" ? ["/Users/tester/Desktop/temp"] : []);
    Equal("/Users/tester/Desktop/temp/ui-my-cli", found);

    var stale = DashboardRepositoryLocator.Inspect("/Users/tester/old-ui-my-cli", files.Contains);
    Equal(true, stale.HasCheckout);
    Equal(false, stale.HasNodeDependencies);
    Equal(false, stale.IsReady);
});

Check("dashboard API v6 requires authoritative native update readiness", () =>
{
    Equal(false, DashboardApiCompatibility.IsCompatible(0));
    Equal(false, DashboardApiCompatibility.IsCompatible(1));
    Equal(false, DashboardApiCompatibility.IsCompatible(2));
    Equal(false, DashboardApiCompatibility.IsCompatible(3));
    Equal(false, DashboardApiCompatibility.IsCompatible(4));
    Equal(false, DashboardApiCompatibility.IsCompatible(5));
    Equal(true, DashboardApiCompatibility.IsCompatible(6));
});

Check("dashboard compatibility probes distinguish mismatches from outages", () =>
{
    var compatible = DashboardApiProbeResult.FromResponse(true, DashboardApiCompatibility.RequiredVersion, 3, "owned");
    Equal(DashboardApiProbeState.Compatible, compatible.State);
    Equal(true, compatible.IsCompatible);
    Equal(3, compatible.ActivePtys);

    var incompatible = DashboardApiProbeResult.FromResponse(true, DashboardApiCompatibility.RequiredVersion + 1);
    Equal(DashboardApiProbeState.Incompatible, incompatible.State);
    Equal(false, incompatible.IsCompatible);
    Equal(true, incompatible.DescribeMismatch(7577).Contains($"requires v{DashboardApiCompatibility.RequiredVersion}"));
    Equal(true, incompatible.CanReplaceOwnedService(ownsService: true));
    Equal(false, incompatible.CanReplaceOwnedService(ownsService: false));
    Equal(false, compatible.CanReplaceOwnedService(ownsService: true));
    Equal(false, DashboardApiProbeResult.FromResponse(true, 3, activePtys: 1).CanReplaceOwnedService(true));

    Equal(DashboardApiProbeState.Unreachable, DashboardApiProbeResult.Unreachable().State);
    Equal(DashboardApiProbeState.Unreachable, DashboardApiProbeResult.FromResponse(false, 99).State);
});

Check("token activity input and output share one truthful chart scale", () =>
{
    Equal(1_000d, TokenChartMath.CommonMaximum([1_000d, 500d], [10d, 5d]));
    Equal(1d, TokenChartMath.CommonMaximum([], []));
});

Check("native versions compare stable release tags", () =>
{
    Equal(new NativeVersion(1, 2, 3), NativeVersion.Parse("v1.2.3"));
    Equal(true, NativeVersion.Parse("2.0.0") > NativeVersion.Parse("1.99.99"));
    Equal(false, NativeVersion.TryParse("1.2.3-beta", out _));
    Equal(false, NativeVersion.TryParse("1.2", out _));
});

Check("session display text cannot expand sidebar rows or tab headers", () =>
{
    var title = SessionDisplayText.Title($"Large session\n\n{new string('x', 300)}");
    Equal(false, title.Contains('\n'));
    Equal(SessionDisplayText.MaximumTitleLength, title.Length);
    Equal(true, title.EndsWith('…'));

    var prompt = SessionDisplayText.PromptPreview($"line one\nline two {new string('p', 600)}");
    Equal(false, prompt.Contains('\n'));
    Equal(SessionDisplayText.MaximumPromptPreviewLength, prompt.Length);
    Equal(false, prompt.Any(char.IsControl));
    Equal("safe prompt", SessionDisplayText.PromptPreview("safe\0\u0085prompt"));
    Equal(string.Empty, SessionDisplayText.PromptPreview(null));

    Equal(
        "Preserve  internal   spaces",
        SessionDisplayText.CanonicalTitleOrDisplay("Preserve  internal   spaces"));

    var emojiTitle = SessionDisplayText.Title($"{new string('x', SessionDisplayText.MaximumTitleLength)}🙂");
    Equal(false, emojiTitle.Contains('\ufffd'));
    Equal(SessionDisplayText.MaximumTitleLength, emojiTitle.Length);
});

Check("legacy session display titles replace every control character", () =>
{
    Equal("safe title", SessionDisplayText.CanonicalTitleOrDisplay("safe\0\u001b\u0085title"));
});

Check("release downloads are restricted to GitHub HTTPS hosts", () =>
{
    Equal(true, GitHubReleaseClient.IsTrustedDownloadUri(
        new Uri("https://release-assets.githubusercontent.com/example/package.zip")));
    Equal(false, GitHubReleaseClient.IsTrustedDownloadUri(
        new Uri("http://github.com/example/package.zip")));
    Equal(false, GitHubReleaseClient.IsTrustedDownloadUri(
        new Uri("https://github.com.evil.example/package.zip")));
    Equal(false, GitHubReleaseClient.IsTrustedDownloadUri(
        new Uri("https://github.com:8443/example/package.zip")));
});

Check("update drain blocks all active Codex work and local shells", () =>
{
    Equal(TimeSpan.FromMinutes(2), NativeUpdatePolicy.DrainTimeout);
    var sessions = new[]
    {
        (Status: "active", IsHeadless: false),
        (Status: "active", IsHeadless: true),
        (Status: "question", IsHeadless: false),
    };
    Equal(2, NativeUpdatePolicy.CountBlockingSessions(sessions));
    Equal(false, NativeUpdatePolicy.CanInstall(sessions, hasRunningLocalShell: false));
    Equal(false, NativeUpdatePolicy.CanInstall([], hasRunningLocalShell: true));
    Equal(true, NativeUpdatePolicy.CanInstall([(Status: "finished", IsHeadless: false)], false));
});

await CheckAsync("update drain recovers one refused data-service request", async () =>
{
    var operationAttempts = 0;
    var recoveryAttempts = 0;
    var result = await NativeUpdateDataServiceRecovery.RunAsync(
        _ => ++operationAttempts == 1
            ? Task.FromException<string>(new HttpRequestException("connection refused"))
            : Task.FromResult("sessions loaded"),
        _ =>
        {
            recoveryAttempts++;
            return Task.FromResult(true);
        });
    Equal("sessions loaded", result);
    Equal(2, operationAttempts);
    Equal(1, recoveryAttempts);
});

await CheckAsync("update drain does not retry failed recovery or user cancellation", async () =>
{
    var failedRecoveryAttempts = 0;
    await ThrowsAsync<InvalidOperationException>(() => NativeUpdateDataServiceRecovery.RunAsync(
        _ => Task.FromException<string>(new HttpRequestException("connection refused")),
        _ =>
        {
            failedRecoveryAttempts++;
            return Task.FromResult(false);
        }));
    Equal(1, failedRecoveryAttempts);

    using var canceled = new CancellationTokenSource();
    canceled.Cancel();
    var cancellationRecoveryAttempts = 0;
    await ThrowsAsync<OperationCanceledException>(() => NativeUpdateDataServiceRecovery.RunAsync(
        token => Task.FromCanceled<string>(token),
        _ =>
        {
            cancellationRecoveryAttempts++;
            return Task.FromResult(true);
        },
        canceled.Token));
    Equal(0, cancellationRecoveryAttempts);
});

Check("updater request preserves paths as structured arguments", () =>
{
    var request = new NativeInstallRequest(
        123,
        NativePlatform.MacOS,
        "/Users/tester/Library/Application Support/CodexNative/updates/1/payload",
        "/Applications/CodexNative.app");
    Equal(request, NativeInstallRequest.Parse(request.ToArguments()));
    Throws<ArgumentException>(() => NativeInstallRequest.Parse(
        ["--parent-pid", "123", "--platform", "macos", "--source", "relative", "--target", "/Applications/CodexNative.app"]));
    Equal(
        "/Applications/CodexNative.app",
        NativeInstallLayout.FindCurrentInstallDirectory(
            NativePlatform.MacOS,
            "/Applications/CodexNative.app/Contents/MacOS"));
});

Check("updater request carries terminal bridges and owned dashboard identity", () =>
{
    var oldRequest = NativeInstallRequest.Parse(
    [
        "--parent-pid", "123", "--platform", "windows",
        "--source", "/updates/payload", "--target", "/apps/CodexNative",
    ]);
    Equal<IReadOnlyList<int>?>(null, oldRequest.RelatedProcessIds);

    var request = new NativeInstallRequest(
        123,
        NativePlatform.Windows,
        "/updates/payload",
        "/apps/CodexNative",
        [456, 789, 456],
        900,
        dashboardServiceStartTime,
        "http://127.0.0.1:7577/api/",
        dashboardInstanceId,
        dashboardControlCapability);
    var parsed = NativeInstallRequest.Parse(request.ToArguments(), dashboardControlCapability);
    SequenceEqual(new[] { 456, 789 }, parsed.RelatedProcessIds ?? []);
    Equal(900, parsed.DashboardServiceProcessId);
    Equal(dashboardServiceStartTime, parsed.DashboardServiceStartTimeUnixMilliseconds);
    Equal("http://127.0.0.1:7577/api/", parsed.DashboardEndpoint);
    Equal(dashboardInstanceId, parsed.DashboardInstanceId);
    Equal(dashboardControlCapability, parsed.DashboardControlCapability);
    Equal(false, request.ToArguments().Contains(dashboardControlCapability));
    Throws<ArgumentException>(() => NativeInstallRequest.Parse(request.ToArguments()));
    Throws<ArgumentException>(() => NativeInstallRequest.Parse(
    [
        "--parent-pid", "123", "--platform", "windows",
        "--source", "/updates/payload", "--target", "/apps/CodexNative",
        "--wait-pids", "123",
    ]));
    Throws<ArgumentException>(() => NativeInstallRequest.Parse(
    [
        "--parent-pid", "123", "--platform", "windows",
        "--source", "/updates/payload", "--target", "/apps/CodexNative",
        "--dashboard-service-pid", "900",
    ]));
    Throws<ArgumentException>(() => NativeInstallRequest.Parse(
    [
        "--parent-pid", "123", "--platform", "windows",
        "--source", "/updates/payload", "--target", "/apps/CodexNative",
        "--dashboard-service-pid", "900",
        "--dashboard-endpoint", "https://example.com/api/",
        "--dashboard-instance-id", dashboardInstanceId,
    ]));
});

Check("dashboard ownership requires PID, start time, instance, and capability", () =>
{
    var ownership = new DashboardServiceOwnership(
        456,
        dashboardServiceStartTime,
        7577,
        dashboardInstanceId,
        dashboardControlCapability);
    Equal(true, ownership.IsStructurallyValid());
    Equal(false, (ownership with { ProcessStartTimeUnixMilliseconds = 0 }).IsStructurallyValid());
    Equal(false, (ownership with { Port = 7575 }).IsStructurallyValid());
    Equal(false, (ownership with { InstanceId = "wrong" }).IsStructurallyValid());
    Equal(false, (ownership with { ControlCapability = new string('A', 63) }).IsStructurallyValid());
});

Check("updater accepts only the explicitly owned dashboard service process", () =>
{
    Equal(true, NativeInstallProcessPolicy.IsVerifiedOwnedDashboardService(
        NativePlatform.Windows,
        "/apps/CodexNative",
        456,
        456,
        "/apps/CodexNative/CodexNative.TerminalHost.exe",
        dashboardServiceStartTime,
        dashboardServiceStartTime));
    Equal(false, NativeInstallProcessPolicy.IsVerifiedOwnedDashboardService(
        NativePlatform.Windows,
        "/apps/CodexNative",
        456,
        789,
        "/apps/CodexNative/CodexNative.TerminalHost.exe",
        dashboardServiceStartTime,
        dashboardServiceStartTime));
    Equal(false, NativeInstallProcessPolicy.IsVerifiedOwnedDashboardService(
        NativePlatform.Windows,
        "/apps/CodexNative",
        456,
        456,
        "/other/CodexNative.TerminalHost.exe",
        dashboardServiceStartTime,
        dashboardServiceStartTime));
    Equal(false, NativeInstallProcessPolicy.IsVerifiedOwnedDashboardService(
        NativePlatform.Windows,
        "/apps/CodexNative",
        456,
        456,
        "/apps/CodexNative/CodexNative.exe",
        dashboardServiceStartTime,
        dashboardServiceStartTime));
    Equal(true, NativeInstallProcessPolicy.IsVerifiedOwnedDashboardService(
        NativePlatform.MacOS,
        "/Applications/CodexNative.app",
        456,
        456,
        "/opt/homebrew/bin/node",
        dashboardServiceStartTime,
        dashboardServiceStartTime));
    Equal(false, NativeInstallProcessPolicy.IsVerifiedOwnedDashboardService(
        NativePlatform.MacOS,
        "/Applications/CodexNative.app",
        456,
        456,
        "/opt/homebrew/bin/node",
        dashboardServiceStartTime,
        dashboardServiceStartTime + 1));
    Equal(true, NativeInstallProcessPolicy.IsMainApplication(
        NativePlatform.MacOS,
        "/Applications/CodexNative.app",
        "/Applications/CodexNative.app/Contents/MacOS/CodexNative"));
    Equal(true, NativeInstallProcessPolicy.IsUpdateBlocker(
        NativePlatform.Windows,
        "/apps/CodexNative",
        789,
        "/apps/CodexNative/CodexNative.exe",
        456));
    Equal(true, NativeInstallProcessPolicy.IsUpdateBlocker(
        NativePlatform.Windows,
        "/apps/CodexNative",
        789,
        "/apps/CodexNative/CodexNative.TerminalHost.exe",
        456));
    Equal(false, NativeInstallProcessPolicy.IsUpdateBlocker(
        NativePlatform.Windows,
        "/apps/CodexNative",
        456,
        "/apps/CodexNative/CodexNative.TerminalHost.exe",
        456));
    Equal(false, NativeInstallProcessPolicy.IsUpdateBlocker(
        NativePlatform.Windows,
        "/apps/CodexNative",
        789,
        "/other/CodexNative.TerminalHost.exe",
        456));
});

await CheckAsync("owned dashboard handoff revalidates before stopping", async () =>
{
    var calls = new List<string>();
    await NativeDashboardUpdatePolicy.RevalidateThenStopAsync(
        dashboardInstanceId,
        _ =>
        {
            calls.Add("probe");
            return Task.FromResult(DashboardApiProbeResult.FromResponse(
                true,
                DashboardApiCompatibility.RequiredVersion,
                0,
                dashboardInstanceId,
                controlAuthenticated: true,
                activityCheckOk: true));
        },
        _ =>
        {
            calls.Add("stop");
            return Task.CompletedTask;
        });
    SequenceEqual(new[] { "probe", "stop" }, calls);

    var stopped = false;
    await ThrowsAsync<InvalidOperationException>(() =>
        NativeDashboardUpdatePolicy.RevalidateThenStopAsync(
            dashboardInstanceId,
            _ => Task.FromResult(DashboardApiProbeResult.FromResponse(
                true,
                DashboardApiCompatibility.RequiredVersion,
                1,
                dashboardInstanceId,
                controlAuthenticated: true,
                activityCheckOk: true)),
            _ =>
            {
                stopped = true;
                return Task.CompletedTask;
            }));
    Equal(false, stopped);

    await ThrowsAsync<InvalidOperationException>(() =>
        NativeDashboardUpdatePolicy.RevalidateThenStopAsync(
            dashboardInstanceId,
            _ => Task.FromResult(DashboardApiProbeResult.FromResponse(
                true,
                DashboardApiCompatibility.RequiredVersion,
                0,
                "6ced4140-c8c6-4290-b467-2cc5613af732",
                controlAuthenticated: true,
                activityCheckOk: true)),
            _ =>
            {
                stopped = true;
                return Task.CompletedTask;
            }));
    Equal(false, stopped);

    await ThrowsAsync<InvalidOperationException>(() =>
        NativeDashboardUpdatePolicy.RevalidateThenStopAsync(
            dashboardInstanceId,
            _ => Task.FromResult(DashboardApiProbeResult.FromResponse(
                true,
                DashboardApiCompatibility.RequiredVersion,
                0,
                dashboardInstanceId,
                controlAuthenticated: true,
                blockingSessions: 1,
                activityCheckOk: true)),
            _ =>
            {
                stopped = true;
                return Task.CompletedTask;
            }));
    Equal(false, stopped);

    await ThrowsAsync<InvalidOperationException>(() =>
        NativeDashboardUpdatePolicy.RevalidateThenStopAsync(
            dashboardInstanceId,
            _ => Task.FromResult(DashboardApiProbeResult.FromResponse(
                true,
                DashboardApiCompatibility.RequiredVersion,
                0,
                dashboardInstanceId)),
            _ =>
            {
                stopped = true;
                return Task.CompletedTask;
            }));
    Equal(false, stopped);
});

Check("updater result is bounded, persisted, and consumed once", () =>
{
    var root = Path.Combine(Path.GetTempPath(), $"codex-native-result-{Guid.NewGuid():N}");
    Directory.CreateDirectory(root);
    try
    {
        NativeUpdateResultStore.Write(
            root,
            new NativeUpdateResult(true, "1.1.5", new string('x', 3000), DateTimeOffset.UtcNow));
        var result = NativeUpdateResultStore.Take(root);
        Equal(true, result!.Succeeded);
        Equal("1.1.5", result.Version);
        Equal(2048, result.Message.Length);
        Equal<NativeUpdateResult?>(null, NativeUpdateResultStore.Take(root));
    }
    finally
    {
        Directory.Delete(root, recursive: true);
    }
});

Check("updater marker validates live process identity", () =>
{
    var root = Path.Combine(Path.GetTempPath(), $"codex-native-marker-{Guid.NewGuid():N}");
    Directory.CreateDirectory(root);
    try
    {
        Equal(false, NativeUpdateInstallationState.IsInProgress(root));
        NativeUpdateInstallationState.MarkInProgress(root);
        Equal(true, NativeUpdateInstallationState.IsInProgress(root));
        NativeUpdateInstallationState.Clear(root);
        Equal(false, NativeUpdateInstallationState.IsInProgress(root));

        var marker = Path.Combine(root, ".codex-native-update-in-progress");
        File.WriteAllText(marker, Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Equal(true, NativeUpdateInstallationState.IsInProgress(root));
        NativeUpdateInstallationState.Clear(root);

        File.WriteAllText(marker, $"{Environment.ProcessId}\n0");
        Equal(false, NativeUpdateInstallationState.IsInProgress(root));
        Equal(false, File.Exists(marker));

        File.WriteAllText(marker, int.MaxValue.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Equal(false, NativeUpdateInstallationState.IsInProgress(root));
        Equal(false, File.Exists(marker));
    }
    finally
    {
        Directory.Delete(root, recursive: true);
    }
});

Check("native install lock is target-specific and exclusive", () =>
{
    var parent = Path.Combine(Path.GetTempPath(), $"codex-native-lock-{Guid.NewGuid():N}");
    var first = Path.Combine(parent, "CodexNative");
    var second = Path.Combine(parent, "OtherNative");
    Directory.CreateDirectory(first);
    Directory.CreateDirectory(second);
    try
    {
        Equal(false, NativeInstallLock.IsHeld(first));
        using (NativeInstallLock.Acquire(first, TimeSpan.FromSeconds(1)))
        {
            Equal(true, NativeInstallLock.IsHeld(first));
            Equal(false, NativeInstallLock.IsHeld(second));
            Throws<TimeoutException>(() => NativeInstallLock.Acquire(first, TimeSpan.FromMilliseconds(20)));
        }
        Equal(false, NativeInstallLock.IsHeld(first));
        Equal(
            Path.Combine(parent, ".CodexNative.update.lock"),
            NativeInstallLock.LockPath(first));
    }
    finally
    {
        Directory.Delete(parent, recursive: true);
    }
});

Check("native startup rejects arbitrary launches during an update lock", () =>
{
    Equal(true, NativeInstallLock.CanStart(
        lockHeld: false,
        updateInProgress: false,
        hasStartupHealthToken: false,
        []));
    Equal(false, NativeInstallLock.CanStart(
        lockHeld: true,
        updateInProgress: true,
        hasStartupHealthToken: false,
        [NativeInstallLock.AuthorizedRestartArgument]));
    Equal(false, NativeInstallLock.CanStart(
        lockHeld: false,
        updateInProgress: true,
        hasStartupHealthToken: false,
        []));
    Equal(true, NativeInstallLock.CanStart(
        lockHeld: true,
        updateInProgress: true,
        hasStartupHealthToken: true,
        [NativeInstallLock.AuthorizedRestartArgument]));
});

Check("native startup health requires framework-ready signal", () =>
{
    var parent = Path.Combine(Path.GetTempPath(), $"codex-native-health-{Guid.NewGuid():N}");
    var install = Path.Combine(parent, "CodexNative");
    Directory.CreateDirectory(install);
    try
    {
        var token = NativeStartupHealthHandshake.CreateToken();
        Equal(token, NativeStartupHealthHandshake.ParseToken(
            [NativeStartupHealthHandshake.Argument, token]));
        Equal(0, NativeStartupHealthHandshake.RemoveArguments(
            [NativeStartupHealthHandshake.Argument, token]).Count);
        Equal(false, NativeStartupHealthHandshake.IsReady(install, token, Environment.ProcessId));
        NativeStartupHealthHandshake.SignalReady(install, token);
        Equal(false, NativeStartupHealthHandshake.IsReady(install, token, Environment.ProcessId + 1));
        Equal(true, NativeStartupHealthHandshake.IsReady(install, token, Environment.ProcessId));
        NativeStartupHealthHandshake.Clear(install, token);
        Equal(false, NativeStartupHealthHandshake.IsReady(install, token, Environment.ProcessId));
        Throws<ArgumentException>(() => NativeStartupHealthHandshake.ParseToken(
            [NativeStartupHealthHandshake.Argument, "invalid"]));
    }
    finally
    {
        Directory.Delete(parent, recursive: true);
    }
});

await CheckAsync("GitHub release selection requires the matching runtime and checksum", async () =>
{
    const string json = """
        {
          "tag_name": "v1.2.0",
          "name": "Codex Native 1.2.0",
          "html_url": "https://github.com/mrshaun13/ui-my-cli/releases/tag/v1.2.0",
          "draft": false,
          "prerelease": false,
          "assets": [
            {"name":"CodexNative-v1.2.0-osx-arm64.zip","browser_download_url":"https://github.com/mrshaun13/ui-my-cli/releases/download/v1.2.0/CodexNative-v1.2.0-osx-arm64.zip","size":123},
            {"name":"CodexNative-v1.2.0-osx-arm64.zip.sha256","browser_download_url":"https://github.com/mrshaun13/ui-my-cli/releases/download/v1.2.0/CodexNative-v1.2.0-osx-arm64.zip.sha256","size":99}
          ]
        }
        """;
    using var http = new HttpClient(new StaticHttpHandler(HttpStatusCode.OK, json));
    using var client = new GitHubReleaseClient(http);
    var release = await client.GetLatestAsync(new NativeVersion(1, 0, 0), "osx-arm64");
    Equal(new NativeVersion(1, 2, 0), release!.Version);
    Equal("CodexNative-v1.2.0-osx-arm64.zip", release.Package.Name);
    Equal("CodexNative-v1.2.0-osx-arm64.zip.sha256", release.Checksum.Name);
});

await CheckAsync("missing GitHub release is treated as no available update", async () =>
{
    using var http = new HttpClient(new StaticHttpHandler(HttpStatusCode.NotFound, "{}"));
    using var client = new GitHubReleaseClient(http);
    Equal<NativeReleaseInfo?>(null, await client.GetLatestAsync(new NativeVersion(1, 0, 0), "win-x64"));
});

await CheckAsync("GitHub rate limits expose the server reset time", async () =>
{
    var reset = DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.AddMinutes(30).ToUnixTimeSeconds());
    using var http = new HttpClient(new StaticHttpHandler(
        HttpStatusCode.Forbidden,
        "{}",
        response => response.Headers.Add("X-RateLimit-Reset", reset.ToUnixTimeSeconds().ToString())));
    using var client = new GitHubReleaseClient(http);
    try
    {
        await client.GetLatestAsync(new NativeVersion(1, 0, 0), "win-x64");
        throw new InvalidOperationException("Expected GitHubRateLimitException.");
    }
    catch (GitHubRateLimitException ex)
    {
        Equal(reset, ex.RetryAt);
    }
});

await CheckAsync("GitHub checks send only an explicitly supplied token", async () =>
{
    AuthenticationHeaderValue? observed = null;
    using var http = new HttpClient(new CallbackHttpHandler(request =>
    {
        observed = request.Headers.Authorization;
        return new HttpResponseMessage(HttpStatusCode.NotFound)
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json"),
        };
    }));
    using var client = new GitHubReleaseClient(http, "explicit-test-token");
    await client.GetLatestAsync(new NativeVersion(1, 0, 0), "win-x64");
    Equal("Bearer", observed?.Scheme);
    Equal("explicit-test-token", observed?.Parameter);
});

await CheckAsync("GitHub release checks reuse cached ETags", async () =>
{
    using var http = new HttpClient(new CallbackHttpHandler(request =>
    {
        Equal("\"release-v1\"", request.Headers.IfNoneMatch.Single().ToString());
        return new HttpResponseMessage(HttpStatusCode.NotModified);
    }));
    using var client = new GitHubReleaseClient(http);
    var query = await client.QueryLatestAsync(
        "win-x64",
        "\"release-v1\"");
    Equal(true, query.NotModified);
    Equal("\"release-v1\"", query.EntityTag);
});

Check("malformed cached GitHub ETags are discarded before update checks", () =>
{
    Equal(true, GitHubReleaseClient.SanitizeEntityTag("malformed etag") is null);
    Equal("\"release-v1\"", GitHubReleaseClient.SanitizeEntityTag("\"release-v1\"")?.ToString());
});

await CheckAsync("GitHub ETag cache retains the latest release across a downgrade", async () =>
{
    const string json = """
        {
          "tag_name": "v1.1.6",
          "name": "Native 1.1.6",
          "draft": false,
          "prerelease": false,
          "html_url": "https://github.com/mrshaun13/ui-my-cli/releases/tag/v1.1.6",
          "assets": [
            { "name": "CodexNative-v1.1.6-win-x64.zip", "browser_download_url": "https://github.com/mrshaun13/ui-my-cli/releases/download/v1.1.6/CodexNative-v1.1.6-win-x64.zip", "size": 100 },
            { "name": "CodexNative-v1.1.6-win-x64.zip.sha256", "browser_download_url": "https://github.com/mrshaun13/ui-my-cli/releases/download/v1.1.6/CodexNative-v1.1.6-win-x64.zip.sha256", "size": 80 }
          ]
        }
        """;
    var requests = 0;
    using var http = new HttpClient(new CallbackHttpHandler(request =>
    {
        requests++;
        if (requests == 1)
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
            response.Headers.ETag = new EntityTagHeaderValue("\"release-v1.1.6\"");
            return response;
        }
        Equal("\"release-v1.1.6\"", request.Headers.IfNoneMatch.Single().ToString());
        return new HttpResponseMessage(HttpStatusCode.NotModified);
    }));
    using var client = new GitHubReleaseClient(http);
    var initial = await client.QueryLatestAsync("win-x64");
    Equal(new NativeVersion(1, 1, 6), initial.Release!.Version);
    var revalidated = await client.QueryLatestAsync("win-x64", initial.EntityTag);
    var cached = revalidated.NotModified ? initial.Release : revalidated.Release;
    Equal(true, cached!.Version > new NativeVersion(1, 1, 5));
});

await CheckAsync("checksum verification rejects changed update bytes", async () =>
{
    var root = Path.Combine(Path.GetTempPath(), $"codex-native-test-{Guid.NewGuid():N}");
    Directory.CreateDirectory(root);
    try
    {
        var archive = Path.Combine(root, "CodexNative-v1.2.0-osx-arm64.zip");
        var checksum = $"{archive}.sha256";
        await File.WriteAllTextAsync(archive, "verified package");
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("verified package"))).ToLowerInvariant();
        await File.WriteAllTextAsync(checksum, $"{digest}  {Path.GetFileName(archive)}\n");
        await NativeUpdatePackage.VerifyChecksumAsync(archive, checksum, Path.GetFileName(archive));
        await File.AppendAllTextAsync(archive, "changed");
        await ThrowsAsync<InvalidDataException>(() =>
            NativeUpdatePackage.VerifyChecksumAsync(archive, checksum, Path.GetFileName(archive)));
    }
    finally
    {
        Directory.Delete(root, recursive: true);
    }
});

Check("archive extraction rejects traversal and symbolic links", () =>
{
    var root = Path.Combine(Path.GetTempPath(), $"codex-native-test-{Guid.NewGuid():N}");
    Directory.CreateDirectory(root);
    try
    {
        var traversal = Path.Combine(root, "traversal.zip");
        using (var archive = ZipFile.Open(traversal, ZipArchiveMode.Create))
            archive.CreateEntry("../outside.txt");
        Throws<InvalidDataException>(() =>
            NativeUpdatePackage.ExtractVerifiedArchive(traversal, Path.Combine(root, "one")));

        var symlink = Path.Combine(root, "symlink.zip");
        using (var archive = ZipFile.Open(symlink, ZipArchiveMode.Create))
        {
            var entry = archive.CreateEntry("CodexNative.app/link");
            entry.ExternalAttributes = 0xA000 << 16;
        }
        Throws<InvalidDataException>(() =>
            NativeUpdatePackage.ExtractVerifiedArchive(symlink, Path.Combine(root, "two")));
    }
    finally
    {
        Directory.Delete(root, recursive: true);
    }
});

Check("resume picker uses the console WSL host", () =>
{
    var spec = NativeLaunchBuilder.ResumePicker(host, "Ubuntu");
    Equal(host, spec.Process);
    SequenceEqual(
        ["--distribution", "Ubuntu", "--mode", "sessions"],
        spec.Arguments);
});

Check("new session preserves the WSL path as one host argument", () =>
{
    var spec = NativeLaunchBuilder.NewSession(host, "Ubuntu-24.04", "/home/tester/a repo");
    SequenceEqual(
        [
            "--distribution", "Ubuntu-24.04", "--mode", "new",
            "--working-directory", "/home/tester/a repo",
        ],
        spec.Arguments);
});

Check("Ubuntu shell uses structured WSL arguments in the selected project", () =>
{
    var hostSpec = NativeLaunchBuilder.UbuntuShell(host, "Ubuntu-24.04", "/home/tester/a repo");
    SequenceEqual(
        [
            "--distribution", "Ubuntu-24.04", "--mode", "ubuntu-shell",
            "--working-directory", "/home/tester/a repo",
        ],
        hostSpec.Arguments);

    var request = NativeLaunchBuilder.ParseHostArguments(hostSpec.Arguments);
    var wsl = NativeLaunchBuilder.BuildWslSpec(request, @"C:\Windows\System32");
    SequenceEqual(
        [
            "--distribution", "Ubuntu-24.04", "--cd", "/home/tester/a repo",
            "--exec", "/usr/bin/env", "TERM=xterm-256color", "COLORTERM=truecolor",
            "/bin/bash", "--login",
        ],
        wsl.Arguments);
});

Check("host builds the structured wsl.exe command", () =>
{
    var request = NativeLaunchBuilder.ParseHostArguments(
        ["--distribution", "Ubuntu", "--mode", "sessions"]);
    var spec = NativeLaunchBuilder.BuildWslSpec(request, @"C:\Windows\System32");
    Equal(@"C:\Windows\System32\wsl.exe", spec.Process);
    SequenceEqual(
        [
            "--distribution", "Ubuntu", "--exec", "/bin/bash", "-lc",
            "export TERM=xterm-256color COLORTERM=truecolor; codex_bin=\"${CODEX_BIN:-}\"; if [ -z \"$codex_bin\" ] && [ -x \"$HOME/.local/bin/codex\" ]; then codex_bin=\"$HOME/.local/bin/codex\"; fi; if [ -z \"$codex_bin\" ]; then codex_bin=\"$(command -v codex || true)\"; fi; if [ -z \"$codex_bin\" ]; then echo 'Codex executable was not found in CODEX_BIN, ~/.local/bin, or PATH.' >&2; exit 127; fi; exec \"$codex_bin\" resume --all",
        ],
        spec.Arguments);
});

Check("direct resume accepts only UUID session IDs", () =>
{
    const string id = "019f397a-e21f-7590-a4c3-794efcb26830";
    var spec = NativeLaunchBuilder.ResumeSession(host, "Ubuntu", "/home/tester/ui-my-cli", id);
    var request = NativeLaunchBuilder.ParseHostArguments(spec.Arguments);
    var wsl = NativeLaunchBuilder.BuildWslSpec(request, @"C:\Windows\System32");
    Equal(
        $"export TERM=xterm-256color COLORTERM=truecolor; codex_bin=\"${{CODEX_BIN:-}}\"; if [ -z \"$codex_bin\" ] && [ -x \"$HOME/.local/bin/codex\" ]; then codex_bin=\"$HOME/.local/bin/codex\"; fi; if [ -z \"$codex_bin\" ]; then codex_bin=\"$(command -v codex || true)\"; fi; if [ -z \"$codex_bin\" ]; then echo 'Codex executable was not found in CODEX_BIN, ~/.local/bin, or PATH.' >&2; exit 127; fi; exec \"$codex_bin\" resume {id}",
        wsl.Arguments[^1]);
    Throws<ArgumentException>(() =>
        NativeLaunchBuilder.ResumeSession(host, "Ubuntu", "/home/tester", "$(bad)"));
});

Check("distribution and path validation reject command injection", () =>
{
    Throws<ArgumentException>(() => NativeLaunchBuilder.ResumePicker(host, "Ubuntu; calc.exe"));
    Throws<ArgumentException>(() => NativeLaunchBuilder.NewSession(host, "Ubuntu", "relative/path"));
    Throws<ArgumentException>(() => NativeLaunchBuilder.UbuntuShell(host, "Ubuntu", "relative/path"));
    Throws<ArgumentException>(() => NativeLaunchBuilder.NewSession(host, "Ubuntu", "/home/user\nmalicious"));
    Throws<ArgumentException>(() => NativeLaunchBuilder.ParseHostArguments(
        ["--distribution", "Ubuntu", "--mode", "unknown"]));
});

Check("dashboard service is launched inside its validated WSL directory", () =>
{
    var hostSpec = NativeLaunchBuilder.DashboardService(
        host, "Ubuntu", "/home/tester/ui-my-cli", 7584, dashboardInstanceId);
    var request = NativeLaunchBuilder.ParseHostArguments(hostSpec.Arguments);
    Equal(7584, request.Port);
    var wsl = NativeLaunchBuilder.BuildWslSpec(request, @"C:\Windows\System32");
    SequenceEqual(
        [
            "--distribution", "Ubuntu", "--cd", "/home/tester/ui-my-cli",
            "--exec", "/bin/bash", "-lc",
            $"export NVM_DIR=\"$HOME/.nvm\"; if [ -s \"$NVM_DIR/nvm.sh\" ]; then . \"$NVM_DIR/nvm.sh\"; nvm use --silent 20 >/dev/null; fi; export NODE_ENV=production PORT=7584 UI_MY_CLI_NATIVE_INSTANCE_ID={dashboardInstanceId}; exec node server/index.js",
        ],
        wsl.Arguments);
    Throws<ArgumentException>(() =>
        NativeLaunchBuilder.DashboardService(host, "Ubuntu", "/home/tester/ui-my-cli", 7597));
    Throws<ArgumentException>(() => NativeLaunchBuilder.ParseHostArguments(
        ["--distribution", "Ubuntu", "--mode", "dashboard-service", "--working-directory", "/home/tester", "--port", "not-a-port"]));
});

Check("server terminal bridge accepts only loopback WebSocket endpoints", () =>
{
    var spec = NativeLaunchBuilder.ServerTerminal(host, "ws://127.0.0.1:7575/ws/codex/terminal/abc?cols=120&rows=36");
    SequenceEqual(
        ["--server-terminal", "ws://127.0.0.1:7575/ws/codex/terminal/abc?cols=120&rows=36"],
        spec.Arguments);
    Throws<ArgumentException>(() => NativeLaunchBuilder.ServerTerminal(host, "https://example.com/terminal"));
    Throws<ArgumentException>(() => NativeLaunchBuilder.ServerTerminal(host, "ws://example.com/terminal"));
});

Check("terminal bridge disables local line editing and enables VT input", () =>
{
    const uint unrelatedFlag = 0x0008;
    var defaultMode = TerminalInputMode.EnableProcessedInput
        | TerminalInputMode.EnableLineInput
        | TerminalInputMode.EnableEchoInput
        | TerminalInputMode.EnableInsertMode
        | TerminalInputMode.EnableQuickEditMode
        | unrelatedFlag;

    var bridgeMode = TerminalInputMode.ForInteractiveBridge(defaultMode);
    Equal(0u, bridgeMode & TerminalInputMode.EnableProcessedInput);
    Equal(0u, bridgeMode & TerminalInputMode.EnableLineInput);
    Equal(0u, bridgeMode & TerminalInputMode.EnableEchoInput);
    Equal(0u, bridgeMode & TerminalInputMode.EnableInsertMode);
    Equal(0u, bridgeMode & TerminalInputMode.EnableQuickEditMode);
    Equal(unrelatedFlag, bridgeMode & unrelatedFlag);
    Equal(TerminalInputMode.EnableExtendedFlags, bridgeMode & TerminalInputMode.EnableExtendedFlags);
    Equal(TerminalInputMode.EnableVirtualTerminalInput, bridgeMode & TerminalInputMode.EnableVirtualTerminalInput);
});

Check("terminal startup waits for output to settle", () =>
{
    var started = DateTimeOffset.Parse("2026-07-07T12:00:00Z");
    var gate = new TerminalStartupGate(
        started,
        TimeSpan.FromMilliseconds(250),
        TimeSpan.FromMilliseconds(450),
        TimeSpan.FromSeconds(10),
        TimeSpan.FromSeconds(10));

    gate.ObserveOutput(started.AddMilliseconds(100));
    Equal(false, gate.ShouldReveal(started.AddMilliseconds(500), terminalReady: true));
    Equal(true, gate.ShouldReveal(started.AddMilliseconds(550), terminalReady: true));
});

Check("new startup output resets the reveal quiet period", () =>
{
    var started = DateTimeOffset.Parse("2026-07-07T12:00:00Z");
    var gate = new TerminalStartupGate(started);

    gate.ObserveOutput(started.AddMilliseconds(100));
    gate.ObserveOutput(started.AddMilliseconds(500));
    Equal(false, gate.ShouldReveal(started.AddMilliseconds(900), terminalReady: true));
    Equal(true, gate.ShouldReveal(started.AddMilliseconds(950), terminalReady: true));
});

Check("terminal startup cannot remain hidden indefinitely", () =>
{
    var started = DateTimeOffset.Parse("2026-07-07T12:00:00Z");
    var gate = new TerminalStartupGate(started);

    Equal(false, gate.ShouldReveal(started.AddSeconds(9)));
    Equal(true, gate.ShouldReveal(started.AddSeconds(10)));
});

Check("continuous terminal startup output has a longer safety ceiling", () =>
{
    var started = DateTimeOffset.Parse("2026-07-07T12:00:00Z");
    var gate = new TerminalStartupGate(started);

    gate.ObserveOutput(started.AddSeconds(29));
    Equal(false, gate.ShouldReveal(started.AddSeconds(29)));
    Equal(true, gate.ShouldReveal(started.AddSeconds(30)));
});

Check("terminal startup does not reveal on a quiet transcript frame", () =>
{
    var started = DateTimeOffset.Parse("2026-07-07T12:00:00Z");
    var gate = new TerminalStartupGate(started);

    gate.ObserveOutput(started.AddMilliseconds(100));
    Equal(false, gate.ShouldReveal(started.AddSeconds(5), terminalReady: false));
});

Check("Codex composer readiness requires the bottom cursor and model status", () =>
{
    var lines = new[] { "Run /review on my current changes", "gpt-5.6-sol xhigh  ·  ~" };
    Equal(true, CodexTerminalReadiness.HasComposer(true, 33, 36, lines));
    Equal(false, CodexTerminalReadiness.HasComposer(false, 33, 36, lines));
    Equal(false, CodexTerminalReadiness.HasComposer(true, 12, 36, lines));
    Equal(false, CodexTerminalReadiness.HasComposer(true, 33, 36, ["transcript still rendering"]));
});

Check("terminal wheel scrolling moves and clamps the viewport", () =>
{
    Equal(47, TerminalViewportScroll.Next(50, 100, 1));
    Equal(53, TerminalViewportScroll.Next(50, 100, -1));
    Equal(0, TerminalViewportScroll.Next(1, 100, 1));
    Equal(100, TerminalViewportScroll.Next(99, 100, -1));
    Equal(0, TerminalViewportScroll.Next(0, -1, -1));
});

Check("terminal clipboard shortcuts preserve shell control keys", () =>
{
    Equal(
        TerminalClipboardAction.CopySelection,
        TerminalClipboardShortcut.Resolve(NativePlatform.Windows, "C", true, false, true, false));
    Equal(
        TerminalClipboardAction.CopyAll,
        TerminalClipboardShortcut.Resolve(NativePlatform.Windows, "A", true, false, true, false));
    Equal(
        TerminalClipboardAction.None,
        TerminalClipboardShortcut.Resolve(NativePlatform.Windows, "A", true, false, false, false));
    Equal(
        TerminalClipboardAction.CopySelection,
        TerminalClipboardShortcut.Resolve(NativePlatform.MacOS, "C", false, true, false, false));
    Equal(
        TerminalClipboardAction.CopyAll,
        TerminalClipboardShortcut.Resolve(NativePlatform.MacOS, "A", false, true, false, false));
    Equal(
        TerminalClipboardAction.Paste,
        TerminalClipboardShortcut.Resolve(NativePlatform.Windows, "Insert", false, false, true, false));
    Equal(
        TerminalClipboardAction.Paste,
        TerminalClipboardShortcut.Resolve(NativePlatform.Windows, "V", true, false, false, false));
});

Check("cold-day grouping includes only idle sessions at the selected boundary", () =>
{
    const long now = 2_000_000;
    Equal(true, SessionAgeGrouping.IsCold("idle", now - 86_400, now, 1));
    Equal(false, SessionAgeGrouping.IsCold("idle", now - 86_399, now, 1));
    Equal(false, SessionAgeGrouping.IsCold("active", now - 172_800, now, 1));
    Equal(false, SessionAgeGrouping.IsCold("question", now - 172_800, now, 1));
    Equal(true, SessionAgeGrouping.IsCold("IDLE", now - 86_400, now, 0));
});

Check("terminal ctrl-click detects only safe web links at the clicked column", () =>
{
    const string line = "Docs: https://example.com/path?q=1, not file:///tmp/nope";
    Equal("https://example.com/path?q=1", TerminalLinkDetector.FindHttpUrlAtColumn(line, 12));
    Equal(null, TerminalLinkDetector.FindHttpUrlAtColumn(line, 2));
    Equal(null, TerminalLinkDetector.FindHttpUrlAtColumn(line, 47));
    Equal(null, TerminalLinkDetector.FindHttpUrlAtColumn("javascript:alert(1)", 5));
    var links = TerminalLinkDetector.FindHttpUrls(line);
    Equal(1, links.Count);
    Equal(line.IndexOf("https://", StringComparison.Ordinal), links[0].Start);
    Equal("https://example.com/path?q=1".Length, links[0].Length);
    Equal("https://example.com/path?q=1", links[0].Url);
});

Check("terminal pane layout equalizes until minimum width then overflows", () =>
{
    Equal(497.5, TerminalPaneLayoutMath.EqualPaneWidth(1000, 2, 460, 5));
    Equal(460d, TerminalPaneLayoutMath.EqualPaneWidth(1000, 3, 460, 5));
    Equal(1390d, TerminalPaneLayoutMath.TotalWidth([460d, 460d, 460d], 5));
    Equal((540d, 460d), TerminalPaneLayoutMath.ResizePair(500, 500, 100, 460));
    Equal((460d, 540d), TerminalPaneLayoutMath.ResizePair(500, 500, -100, 460));
});

Check("terminal pane layout follows viewport changes while preserving usable proportions", () =>
{
    SequenceEqual(
        [900d, 600d],
        TerminalPaneLayoutMath.FitPaneWidths([600d, 400d], 1505, 460, 5));
    SequenceEqual(
        [540d, 460d],
        TerminalPaneLayoutMath.FitPaneWidths([900d, 600d], 1005, 460, 5));
    SequenceEqual(
        [460d, 460d],
        TerminalPaneLayoutMath.FitPaneWidths([900d, 600d], 800, 460, 5));
    SequenceEqual(
        [1200d],
        TerminalPaneLayoutMath.FitPaneWidths([460d], 1200, 460, 5));
});

Check("speech lifecycle serializes recording, transcription, cancellation, and failure", () =>
{
    var lifecycle = new SpeechSessionStateMachine();
    Equal(true, lifecycle.TryStart("one"));
    Equal(false, lifecycle.TryStart("two"));
    Equal(false, lifecycle.TryBeginTranscription("two"));
    Equal(true, lifecycle.TryBeginTranscription("one"));
    Equal(true, lifecycle.TryFail("one", "model failed"));
    Equal(SpeechStage.Failed, lifecycle.Stage);
    Equal("model failed", lifecycle.LastError);
    Equal(true, lifecycle.TryCancel("one"));
    Equal(SpeechStage.Idle, lifecycle.Stage);
    Equal(true, lifecycle.TryBeginDownload("model"));
    Equal(true, lifecycle.TryComplete("model"));
});

Check("speech operation cleanup cannot replace a newer operation", () =>
{
    var ownership = new SpeechOperationOwnership<object>();
    var first = new object();
    var second = new object();
    ownership.Set(first);
    Equal(true, ownership.ClearIfCurrent(first));
    ownership.Set(second);
    Equal(false, ownership.ClearIfCurrent(first));
    Equal(second, ownership.Current);
});

Check("speech capture is bounded to the two-minute policy", () =>
{
    Equal(120, SpeechCapturePolicy.MaximumDurationSeconds);
    Equal(1_920_000, SpeechCapturePolicy.MaximumSampleCount(16000));
    Throws<ArgumentOutOfRangeException>(() => SpeechCapturePolicy.MaximumSampleCount(0));

    var buffer = new SpeechSampleBuffer(5);
    Equal(false, buffer.Append(new float[] { 1, 2, 3 }));
    Equal(true, buffer.Append(new float[] { 4, 5, 6 }));
    Equal(false, buffer.Append(new float[] { 7 }));
    Equal(5, buffer.Count);
    SequenceEqual(new float[] { 1, 2, 3, 4, 5 }, buffer.Drain());
    Equal(0, buffer.Count);
});

Check("speech parity measures capture health and word error rate", () =>
{
    var samples = Enumerable.Repeat(0f, 1600)
        .Concat(Enumerable.Repeat(0.25f, 12800))
        .Concat(Enumerable.Repeat(0f, 1600))
        .ToArray();
    var metrics = SpeechCaptureAnalysis.Analyze(samples, 16000, 80);
    Equal(1000d, metrics.DurationMs);
    Equal(100d, metrics.LeadingSilenceMs);
    Equal(100d, metrics.TrailingSilenceMs);
    Equal(0d, metrics.ClippedSamplePercent);
    Equal(0d, SpeechParityEvaluator.WordErrorRate("Route this prompt", "route this prompt"));
    Equal(1d / 3d, SpeechParityEvaluator.WordErrorRate("route prompt", "route this prompt"));
    Equal(true, SpeechParityEvaluator.Evaluate(metrics, "route this prompt", "route this prompt").Passed);

    var failed = SpeechParityEvaluator.Evaluate(
        metrics with { StartLatencyMs = 400, ClippedSamplePercent = 2 },
        "wrong words",
        "route this prompt");
    Equal(false, failed.Passed);
    Equal(3, failed.Failures.Count);
});

Check("clipboard screenshot paths become standalone host composer references", () =>
{
    var wslPath = ScreenshotAttachmentPath.ToWslPath(
        @"C:\Users\tester\AppData\Local\CodexNative\captures\shot.png");
    Equal("/mnt/c/Users/tester/AppData/Local/CodexNative/captures/shot.png", wslPath);
    Equal(
        "`/mnt/c/Users/tester/AppData/Local/CodexNative/captures/shot.png` ",
        ScreenshotAttachmentPath.ComposerReference(wslPath));
    Equal(
        "`/Users/tester/Library/Application Support/CodexNative/captures/shot.png` ",
        ScreenshotAttachmentPath.ComposerReference(
            "/Users/tester/Library/Application Support/CodexNative/captures/shot.png"));
    Throws<ArgumentException>(() => ScreenshotAttachmentPath.ToWslPath(@"relative\shot.png"));
    Throws<ArgumentException>(() => ScreenshotAttachmentPath.ComposerReference("/tmp/bad`path.png"));
});

if (failures.Count > 0)
{
    Console.Error.WriteLine($"{failures.Count} native command test(s) failed:");
    foreach (var failure in failures)
    {
        Console.Error.WriteLine($"- {failure}");
    }
    return 1;
}

Console.WriteLine("All native command tests passed.");
return 0;

void Check(string name, Action test)
{
    try
    {
        test();
        Console.WriteLine($"PASS {name}");
    }
    catch (Exception ex)
    {
        failures.Add($"{name}: {ex.Message}");
    }
}

async Task CheckAsync(string name, Func<Task> test)
{
    try
    {
        await test();
        Console.WriteLine($"PASS {name}");
    }
    catch (Exception ex)
    {
        failures.Add($"{name}: {ex.Message}");
    }
}

static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
    {
        throw new InvalidOperationException($"Expected '{expected}', received '{actual}'.");
    }
}

static void SequenceEqual<T>(IEnumerable<T> expected, IEnumerable<T> actual)
{
    if (!expected.SequenceEqual(actual))
    {
        throw new InvalidOperationException(
            $"Expected [{string.Join(", ", expected)}], received [{string.Join(", ", actual)}].");
    }
}

static void Throws<TException>(Action action) where TException : Exception
{
    try
    {
        action();
    }
    catch (TException)
    {
        return;
    }

    throw new InvalidOperationException($"Expected {typeof(TException).Name}.");
}

static string ThrowsMessage<TException>(Action action) where TException : Exception
{
    try
    {
        action();
    }
    catch (TException ex)
    {
        return ex.Message;
    }

    throw new InvalidOperationException($"Expected {typeof(TException).Name}.");
}

static async Task ThrowsAsync<TException>(Func<Task> action) where TException : Exception
{
    try
    {
        await action();
    }
    catch (TException)
    {
        return;
    }

    throw new InvalidOperationException($"Expected {typeof(TException).Name}.");
}

static async Task VerifyReleaseArtifactsAsync(
    string artifactDirectory,
    IReadOnlyList<string> runtimeIdentifiers)
{
    var assemblyVersion = typeof(NativeVersion).Assembly.GetName().Version
        ?? throw new InvalidOperationException("Native core assembly has no version.");
    var nativeVersion = new NativeVersion(
        assemblyVersion.Major,
        assemblyVersion.Minor,
        assemblyVersion.Build);
    var runtimes = runtimeIdentifiers.Count == 0
        ? ["win-x64", "osx-x64", "osx-arm64"]
        : runtimeIdentifiers;
    foreach (var runtime in runtimes)
    {
        if (runtime is not ("win-x64" or "osx-x64" or "osx-arm64"))
            throw new ArgumentException($"Unsupported release runtime: {runtime}.", nameof(runtimeIdentifiers));
        var fileName = GitHubReleaseClient.PackageAssetName(runtime, nativeVersion);
        var archive = Path.Combine(artifactDirectory, fileName);
        var checksum = $"{archive}.sha256";
        await NativeUpdatePackage.VerifyChecksumAsync(archive, checksum, fileName);
        var extraction = Path.Combine(
            Path.GetTempPath(),
            $"codex-native-artifact-{runtime}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(extraction);
        try
        {
            NativeUpdatePackage.ExtractVerifiedArchive(archive, extraction);
            var required = runtime == "win-x64"
                ? new[]
                {
                    Path.Combine(extraction, "CodexNative.exe"),
                    Path.Combine(extraction, "CodexNative.TerminalHost.exe"),
                    Path.Combine(extraction, "CodexNative.SpeechHost.exe"),
                    Path.Combine(extraction, "CodexNative.Updater.exe"),
                    Path.Combine(extraction, "runtimes", "win-x64", "whisper.dll"),
                    Path.Combine(extraction, "runtimes", "win-x64", "ggml-whisper.dll"),
                    Path.Combine(extraction, "runtimes", "win-x64", "ggml-base-whisper.dll"),
                    Path.Combine(extraction, "runtimes", "win-x64", "ggml-cpu-whisper.dll"),
                }
                :
                [
                    Path.Combine(extraction, "CodexNative.app", "Contents", "Info.plist"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "CodexNative"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "CodexNative.TerminalHost"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "CodexNative.SpeechHost"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "CodexNative.Updater"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "runtimes", runtime == "osx-arm64" ? "macos-arm64" : "macos-x64", "libwhisper.dylib"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "runtimes", runtime == "osx-arm64" ? "macos-arm64" : "macos-x64", "libggml-whisper.dylib"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "runtimes", runtime == "osx-arm64" ? "macos-arm64" : "macos-x64", "libggml-base-whisper.dylib"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "runtimes", runtime == "osx-arm64" ? "macos-arm64" : "macos-x64", "libggml-cpu-whisper.dylib"),
                ];
            foreach (var requiredFile in required)
            {
                if (!File.Exists(requiredFile))
                    throw new InvalidDataException($"{fileName} is missing {requiredFile}.");
            }
            if (runtime.StartsWith("osx-", StringComparison.Ordinal))
            {
                var plist = await File.ReadAllTextAsync(required[0]);
                var expectedArchitecture = runtime == "osx-x64" ? "x86_64" : "arm64";
                if (!plist.Contains($"<string>{expectedArchitecture}</string>", StringComparison.Ordinal))
                    throw new InvalidDataException($"{fileName} plist does not declare {expectedArchitecture}.");
            }
        }
        finally
        {
            Directory.Delete(extraction, recursive: true);
        }
        Console.WriteLine($"PASS verified release artifact {fileName}");
    }
}

sealed class StaticHttpHandler(
    HttpStatusCode statusCode,
    string body,
    Action<HttpResponseMessage>? configure = null) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var response = new HttpResponseMessage(statusCode)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        configure?.Invoke(response);
        return Task.FromResult(response);
    }
}

sealed class CallbackHttpHandler(Func<HttpRequestMessage, HttpResponseMessage> callback) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken) => Task.FromResult(callback(request));
}
