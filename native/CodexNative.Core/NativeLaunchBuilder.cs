namespace CodexNative.Core;

public enum NativeLaunchMode
{
    Sessions,
    NewSession,
    ResumeSession,
    UbuntuShell,
    DashboardService,
}

public sealed record WslHostRequest(
    NativeLaunchMode Mode,
    string Distribution,
    string? WorkingDirectory = null,
    string? SessionId = null);

public sealed record NativeLaunchSpec(string Process, IReadOnlyList<string> Arguments);

public static class NativeLaunchBuilder
{
    private const string CodexExecutable = "$HOME/.local/bin/codex";
    private const string TerminalEnvironment = "export TERM=xterm-256color COLORTERM=truecolor; ";

    public static NativeLaunchSpec ResumePicker(string hostExecutable, string distribution) =>
        BuildHostSpec(hostExecutable, new WslHostRequest(NativeLaunchMode.Sessions, distribution));

    public static NativeLaunchSpec NewSession(
        string hostExecutable,
        string distribution,
        string workingDirectory) =>
        BuildHostSpec(
            hostExecutable,
            new WslHostRequest(NativeLaunchMode.NewSession, distribution, workingDirectory));

    public static NativeLaunchSpec ResumeSession(
        string hostExecutable,
        string distribution,
        string workingDirectory,
        string sessionId) =>
        BuildHostSpec(
            hostExecutable,
            new WslHostRequest(NativeLaunchMode.ResumeSession, distribution, workingDirectory, sessionId));

    public static NativeLaunchSpec UbuntuShell(
        string hostExecutable,
        string distribution,
        string workingDirectory) =>
        BuildHostSpec(
            hostExecutable,
            new WslHostRequest(NativeLaunchMode.UbuntuShell, distribution, workingDirectory));

    public static NativeLaunchSpec DashboardService(
        string hostExecutable,
        string distribution,
        string workingDirectory) =>
        BuildHostSpec(
            hostExecutable,
            new WslHostRequest(NativeLaunchMode.DashboardService, distribution, workingDirectory));

    public static NativeLaunchSpec ServerTerminal(string hostExecutable, string endpoint)
    {
        if (string.IsNullOrWhiteSpace(hostExecutable))
            throw new ArgumentException("Terminal bridge executable is required.", nameof(hostExecutable));
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("ws" or "wss")
            || uri.Host is not ("127.0.0.1" or "localhost"))
            throw new ArgumentException("Terminal endpoint must be a loopback WebSocket URL.", nameof(endpoint));
        return new NativeLaunchSpec(hostExecutable, ["--server-terminal", uri.AbsoluteUri]);
    }

    public static WslHostRequest ParseHostArguments(IReadOnlyList<string> arguments)
    {
        string? distribution = null;
        string? workingDirectory = null;
        string? sessionId = null;
        NativeLaunchMode? mode = null;

        for (var index = 0; index < arguments.Count; index++)
        {
            var name = arguments[index];
            if (index + 1 >= arguments.Count)
            {
                throw new ArgumentException($"Missing value for '{name}'.", nameof(arguments));
            }

            var value = arguments[++index];
            switch (name)
            {
                case "--distribution":
                    distribution = value;
                    break;
                case "--mode":
                    mode = value switch
                    {
                        "sessions" => NativeLaunchMode.Sessions,
                        "new" => NativeLaunchMode.NewSession,
                        "resume" => NativeLaunchMode.ResumeSession,
                        "ubuntu-shell" => NativeLaunchMode.UbuntuShell,
                        "dashboard-service" => NativeLaunchMode.DashboardService,
                        _ => throw new ArgumentException($"Unknown launch mode '{value}'.", nameof(arguments)),
                    };
                    break;
                case "--working-directory":
                    workingDirectory = value;
                    break;
                case "--session-id":
                    sessionId = value;
                    break;
                default:
                    throw new ArgumentException($"Unknown host argument '{name}'.", nameof(arguments));
            }
        }

        return ValidateRequest(new WslHostRequest(
            mode ?? throw new ArgumentException("Missing --mode.", nameof(arguments)),
            distribution ?? throw new ArgumentException("Missing --distribution.", nameof(arguments)),
            workingDirectory,
            sessionId));
    }

    public static NativeLaunchSpec BuildWslSpec(WslHostRequest request, string windowsSystemDirectory)
    {
        ValidateRequest(request);
        if (string.IsNullOrWhiteSpace(windowsSystemDirectory))
        {
            throw new ArgumentException("Windows system directory is required.", nameof(windowsSystemDirectory));
        }

        var arguments = new List<string>
        {
            "--distribution",
            request.Distribution,
        };

        if (request.Mode is NativeLaunchMode.NewSession
            or NativeLaunchMode.ResumeSession
            or NativeLaunchMode.UbuntuShell
            or NativeLaunchMode.DashboardService)
        {
            arguments.Add("--cd");
            arguments.Add(request.WorkingDirectory!);
        }

        arguments.Add("--exec");
        if (request.Mode == NativeLaunchMode.UbuntuShell)
        {
            arguments.Add("/usr/bin/env");
            arguments.Add("TERM=xterm-256color");
            arguments.Add("COLORTERM=truecolor");
            arguments.Add("/bin/bash");
            arguments.Add("--login");
            return new NativeLaunchSpec(
                $"{windowsSystemDirectory.TrimEnd('\\', '/')}\\wsl.exe",
                arguments);
        }

        arguments.Add("/bin/bash");
        arguments.Add("-lc");
        arguments.Add(request.Mode switch
        {
            NativeLaunchMode.Sessions =>
                $"{TerminalEnvironment}exec {CodexExecutable} resume --all",
            NativeLaunchMode.NewSession =>
                $"{TerminalEnvironment}exec {CodexExecutable}",
            NativeLaunchMode.ResumeSession =>
                $"{TerminalEnvironment}exec {CodexExecutable} resume {request.SessionId}",
            NativeLaunchMode.DashboardService =>
                "export NVM_DIR=\"$HOME/.nvm\"; if [ -s \"$NVM_DIR/nvm.sh\" ]; then . \"$NVM_DIR/nvm.sh\"; nvm use --silent 20 >/dev/null; fi; export NODE_ENV=production PORT=7577; exec node server/index.js",
            _ => throw new ArgumentOutOfRangeException(nameof(request)),
        });

        return new NativeLaunchSpec(
            $"{windowsSystemDirectory.TrimEnd('\\', '/')}\\wsl.exe",
            arguments);
    }

    public static bool IsValidDistribution(string value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Length <= 64
        && value.All(character => char.IsLetterOrDigit(character) || character is '-' or '_' or '.');

    public static bool IsValidLinuxPath(string value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Length <= 4096
        && value.StartsWith("/", StringComparison.Ordinal)
        && !value.Any(char.IsControl);

    public static bool IsValidSessionId(string value) => Guid.TryParse(value, out _);

    private static NativeLaunchSpec BuildHostSpec(string hostExecutable, WslHostRequest request)
    {
        ValidateRequest(request);
        if (string.IsNullOrWhiteSpace(hostExecutable))
        {
            throw new ArgumentException("WSL host executable is required.", nameof(hostExecutable));
        }

        var arguments = new List<string>
        {
            "--distribution",
            request.Distribution,
            "--mode",
            request.Mode switch
            {
                NativeLaunchMode.Sessions => "sessions",
                NativeLaunchMode.NewSession => "new",
                NativeLaunchMode.ResumeSession => "resume",
                NativeLaunchMode.UbuntuShell => "ubuntu-shell",
                NativeLaunchMode.DashboardService => "dashboard-service",
                _ => throw new ArgumentOutOfRangeException(nameof(request)),
            },
        };

        if (request.WorkingDirectory is not null)
        {
            arguments.Add("--working-directory");
            arguments.Add(request.WorkingDirectory);
        }

        if (request.SessionId is not null)
        {
            arguments.Add("--session-id");
            arguments.Add(request.SessionId);
        }

        return new NativeLaunchSpec(hostExecutable, arguments);
    }

    private static WslHostRequest ValidateRequest(WslHostRequest request)
    {
        if (!IsValidDistribution(request.Distribution))
        {
            throw new ArgumentException(
                "WSL distribution must contain only letters, numbers, '.', '-' or '_'.",
                nameof(request));
        }

        if (request.Mode is NativeLaunchMode.NewSession
                or NativeLaunchMode.ResumeSession
                or NativeLaunchMode.UbuntuShell
                or NativeLaunchMode.DashboardService
            && !IsValidLinuxPath(request.WorkingDirectory ?? string.Empty))
        {
            throw new ArgumentException(
                "WSL working directory must be an absolute Linux path without control characters.",
                nameof(request));
        }

        if (request.Mode == NativeLaunchMode.ResumeSession
            && !IsValidSessionId(request.SessionId ?? string.Empty))
        {
            throw new ArgumentException("Codex session ID must be a UUID.", nameof(request));
        }

        return request;
    }
}
