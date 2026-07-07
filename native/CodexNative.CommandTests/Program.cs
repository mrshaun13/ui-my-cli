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
            "export TERM=xterm-256color COLORTERM=truecolor; exec $HOME/.local/bin/codex resume --all",
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
        $"export TERM=xterm-256color COLORTERM=truecolor; exec $HOME/.local/bin/codex resume {id}",
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
