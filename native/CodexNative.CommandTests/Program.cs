using CodexNative.Core;

var failures = new List<string>();
const string host = @"C:\Apps\CodexNative.WslHost.exe";

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
