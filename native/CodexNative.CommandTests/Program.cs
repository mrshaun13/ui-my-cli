using CodexNative.Core;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;

var failures = new List<string>();
const string host = @"C:\Apps\CodexNative.TerminalHost.exe";

if (args is ["--verify-release-artifacts", var artifactDirectory])
{
    await VerifyReleaseArtifactsAsync(artifactDirectory);
    return 0;
}

Check("platform profiles select the correct terminal host and release runtime", () =>
{
    var windows = NativePlatformProfile.For(NativePlatform.Windows);
    Equal(true, windows.UsesWsl);
    Equal("CodexNative.TerminalHost.exe", windows.TerminalHostFileName);
    Equal("win-x64", windows.ReleaseRuntimeIdentifier);

    var macArm = NativePlatformProfile.For(
        NativePlatform.MacOS,
        System.Runtime.InteropServices.Architecture.Arm64);
    Equal(false, macArm.UsesWsl);
    Equal("macOS shell", macArm.LocalShellLabel);
    Equal("CodexNative.TerminalHost", macArm.TerminalHostFileName);
    Equal("osx-arm64", macArm.ReleaseRuntimeIdentifier);
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
        new[] { "TERM=xterm-256color", "COLORTERM=truecolor", "/bin/zsh", "-l" },
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
        "/opt/homebrew/bin/node");
    Equal("/opt/homebrew/bin/node", spec.Process);
    Equal("/Users/tester/ui-my-cli", spec.WorkingDirectory);
    SequenceEqual(new[] { "server/index.js" }, spec.Arguments);
    Equal("production", spec.Environment!["NODE_ENV"]);
    Equal("7577", spec.Environment["PORT"]);
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
    };
    var found = DashboardRepositoryLocator.Find(
        "/Users/tester/ui-my-cli/native/artifacts/osx-arm64/CodexNative.app/Contents/MacOS",
        "/Users/tester",
        null,
        files.Contains);
    Equal("/Users/tester/ui-my-cli", found);
});

Check("dashboard API v1 accepts legacy unversioned services only", () =>
{
    Equal(true, DashboardApiCompatibility.IsCompatible(0));
    Equal(true, DashboardApiCompatibility.IsCompatible(1));
    Equal(false, DashboardApiCompatibility.IsCompatible(2));
});

Check("native versions compare stable release tags", () =>
{
    Equal(new NativeVersion(1, 2, 3), NativeVersion.Parse("v1.2.3"));
    Equal(true, NativeVersion.Parse("2.0.0") > NativeVersion.Parse("1.99.99"));
    Equal(false, NativeVersion.TryParse("1.2.3-beta", out _));
    Equal(false, NativeVersion.TryParse("1.2", out _));
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
            {"name":"CodexNative-osx-arm64.zip","browser_download_url":"https://github.com/mrshaun13/ui-my-cli/releases/download/v1.2.0/CodexNative-osx-arm64.zip","size":123},
            {"name":"CodexNative-osx-arm64.zip.sha256","browser_download_url":"https://github.com/mrshaun13/ui-my-cli/releases/download/v1.2.0/CodexNative-osx-arm64.zip.sha256","size":99}
          ]
        }
        """;
    using var http = new HttpClient(new StaticHttpHandler(HttpStatusCode.OK, json));
    using var client = new GitHubReleaseClient(http);
    var release = await client.GetLatestAsync(new NativeVersion(1, 0, 0), "osx-arm64");
    Equal(new NativeVersion(1, 2, 0), release!.Version);
    Equal("CodexNative-osx-arm64.zip", release.Package.Name);
    Equal("CodexNative-osx-arm64.zip.sha256", release.Checksum.Name);
});

await CheckAsync("missing GitHub release is treated as no available update", async () =>
{
    using var http = new HttpClient(new StaticHttpHandler(HttpStatusCode.NotFound, "{}"));
    using var client = new GitHubReleaseClient(http);
    Equal<NativeReleaseInfo?>(null, await client.GetLatestAsync(new NativeVersion(1, 0, 0), "win-x64"));
});

await CheckAsync("checksum verification rejects changed update bytes", async () =>
{
    var root = Path.Combine(Path.GetTempPath(), $"codex-native-test-{Guid.NewGuid():N}");
    Directory.CreateDirectory(root);
    try
    {
        var archive = Path.Combine(root, "CodexNative-osx-arm64.zip");
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
        new[] { "--distribution", "Ubuntu", "--mode", "sessions" },
        spec.Arguments);
});

Check("new session preserves the WSL path as one host argument", () =>
{
    var spec = NativeLaunchBuilder.NewSession(host, "Ubuntu-24.04", "/home/tester/a repo");
    SequenceEqual(
        new[]
        {
            "--distribution", "Ubuntu-24.04", "--mode", "new",
            "--working-directory", "/home/tester/a repo",
        },
        spec.Arguments);
});

Check("Ubuntu shell uses structured WSL arguments in the selected project", () =>
{
    var hostSpec = NativeLaunchBuilder.UbuntuShell(host, "Ubuntu-24.04", "/home/tester/a repo");
    SequenceEqual(
        new[]
        {
            "--distribution", "Ubuntu-24.04", "--mode", "ubuntu-shell",
            "--working-directory", "/home/tester/a repo",
        },
        hostSpec.Arguments);

    var request = NativeLaunchBuilder.ParseHostArguments(hostSpec.Arguments);
    var wsl = NativeLaunchBuilder.BuildWslSpec(request, @"C:\Windows\System32");
    SequenceEqual(
        new[]
        {
            "--distribution", "Ubuntu-24.04", "--cd", "/home/tester/a repo",
            "--exec", "/usr/bin/env", "TERM=xterm-256color", "COLORTERM=truecolor",
            "/bin/bash", "--login",
        },
        wsl.Arguments);
});

Check("host builds the structured wsl.exe command", () =>
{
    var request = NativeLaunchBuilder.ParseHostArguments(
        new[] { "--distribution", "Ubuntu", "--mode", "sessions" });
    var spec = NativeLaunchBuilder.BuildWslSpec(request, @"C:\Windows\System32");
    Equal(@"C:\Windows\System32\wsl.exe", spec.Process);
    SequenceEqual(
        new[]
        {
            "--distribution", "Ubuntu", "--exec", "/bin/bash", "-lc",
            "export TERM=xterm-256color COLORTERM=truecolor; codex_bin=\"${CODEX_BIN:-}\"; if [ -z \"$codex_bin\" ] && [ -x \"$HOME/.local/bin/codex\" ]; then codex_bin=\"$HOME/.local/bin/codex\"; fi; if [ -z \"$codex_bin\" ]; then codex_bin=\"$(command -v codex || true)\"; fi; if [ -z \"$codex_bin\" ]; then echo 'Codex executable was not found in CODEX_BIN, ~/.local/bin, or PATH.' >&2; exit 127; fi; exec \"$codex_bin\" resume --all",
        },
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
        new[] { "--distribution", "Ubuntu", "--mode", "unknown" }));
});

Check("dashboard service is launched inside its validated WSL directory", () =>
{
    var hostSpec = NativeLaunchBuilder.DashboardService(host, "Ubuntu", "/home/tester/ui-my-cli");
    var request = NativeLaunchBuilder.ParseHostArguments(hostSpec.Arguments);
    var wsl = NativeLaunchBuilder.BuildWslSpec(request, @"C:\Windows\System32");
    SequenceEqual(
        new[]
        {
            "--distribution", "Ubuntu", "--cd", "/home/tester/ui-my-cli",
            "--exec", "/bin/bash", "-lc",
            "export NVM_DIR=\"$HOME/.nvm\"; if [ -s \"$NVM_DIR/nvm.sh\" ]; then . \"$NVM_DIR/nvm.sh\"; nvm use --silent 20 >/dev/null; fi; export NODE_ENV=production PORT=7577; exec node server/index.js",
        },
        wsl.Arguments);
});

Check("server terminal bridge accepts only loopback WebSocket endpoints", () =>
{
    var spec = NativeLaunchBuilder.ServerTerminal(host, "ws://127.0.0.1:7575/ws/codex/terminal/abc?cols=120&rows=36");
    SequenceEqual(
        new[] { "--server-terminal", "ws://127.0.0.1:7575/ws/codex/terminal/abc?cols=120&rows=36" },
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
    Equal(false, CodexTerminalReadiness.HasComposer(true, 33, 36, new[] { "transcript still rendering" }));
});

Check("terminal wheel scrolling moves and clamps the viewport", () =>
{
    Equal(47, TerminalViewportScroll.Next(50, 100, 1));
    Equal(53, TerminalViewportScroll.Next(50, 100, -1));
    Equal(0, TerminalViewportScroll.Next(1, 100, 1));
    Equal(100, TerminalViewportScroll.Next(99, 100, -1));
    Equal(0, TerminalViewportScroll.Next(0, -1, -1));
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

static async Task VerifyReleaseArtifactsAsync(string artifactDirectory)
{
    foreach (var runtime in new[] { "win-x64", "osx-x64", "osx-arm64" })
    {
        var fileName = GitHubReleaseClient.PackageAssetName(runtime);
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
                    Path.Combine(extraction, "CodexNative.Updater.exe"),
                }
                : new[]
                {
                    Path.Combine(extraction, "CodexNative.app", "Contents", "Info.plist"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "CodexNative"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "CodexNative.TerminalHost"),
                    Path.Combine(extraction, "CodexNative.app", "Contents", "MacOS", "CodexNative.Updater"),
                };
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

sealed class StaticHttpHandler(HttpStatusCode statusCode, string body) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken) =>
        Task.FromResult(new HttpResponseMessage(statusCode)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        });
}
