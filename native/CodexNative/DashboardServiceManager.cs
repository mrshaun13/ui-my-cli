using System.Diagnostics;
using CodexNative.Core;

namespace CodexNative;

public sealed class DashboardServiceManager : IDisposable
{
    private Process? _process;

    public bool OwnsRunningService
    {
        get
        {
            try { return _process is { HasExited: false }; }
            catch (InvalidOperationException) { return false; }
        }
    }

    public bool TryGetExitCode(out int exitCode)
    {
        exitCode = 0;
        try
        {
            if (_process is not { HasExited: true }) return false;
            exitCode = _process.ExitCode;
            return true;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    public void EnsureStarted(
        NativePlatform platform,
        string hostExecutable,
        string distribution,
        string dashboardDirectory,
        string? nodeExecutable = null,
        int port = DashboardServicePorts.FirstPrivate)
    {
        if (_process is { HasExited: false })
        {
            return;
        }

        var spec = NativeLaunchBuilder.DashboardService(
            platform,
            hostExecutable,
            distribution,
            dashboardDirectory,
            nodeExecutable,
            port);
        var startInfo = new ProcessStartInfo
        {
            // LaunchServices can tear down children that remain attached to a
            // GUI app's job when the window exits. The local dashboard owns
            // persistent PTYs, so on macOS it must explicitly ignore hangups
            // and outlive a closing/reopening native UI.
            FileName = platform == NativePlatform.MacOS ? "/usr/bin/nohup" : spec.Process,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = spec.WorkingDirectory ?? string.Empty,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        if (platform == NativePlatform.MacOS)
        {
            startInfo.ArgumentList.Add(spec.Process);
        }
        foreach (var argument in spec.Arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }
        foreach (var variable in spec.Environment ?? new Dictionary<string, string>())
        {
            startInfo.Environment[variable.Key] = variable.Value;
        }

        _process?.Dispose();
        var process = new Process
        {
            StartInfo = startInfo,
            EnableRaisingEvents = true,
        };
        process.OutputDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data))
                NativeLog.Write($"Dashboard service stdout: {args.Data}");
        };
        process.ErrorDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data))
                NativeLog.Write($"Dashboard service stderr: {args.Data}");
        };
        process.Exited += (_, _) =>
        {
            try
            {
                NativeLog.Write($"Dashboard service host exited with code {process.ExitCode}.");
            }
            catch (InvalidOperationException)
            {
                NativeLog.Write("Dashboard service host exited before its exit code was available.");
            }
        };

        NativeLog.Write(
            $"Starting dashboard service on port {port} with '{spec.Process}' in '{startInfo.WorkingDirectory}' " +
            (platform == NativePlatform.MacOS ? "through nohup." : "directly."));
        try
        {
            if (!process.Start())
                throw new InvalidOperationException("The operating system did not start the dashboard data service.");
        }
        catch
        {
            process.Dispose();
            throw;
        }
        _process = process;
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        NativeLog.Write($"Dashboard service host started with PID {process.Id}.");
    }

    public bool StopOwnedService()
    {
        var process = _process;
        if (process is null) return false;
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit((int)TimeSpan.FromSeconds(5).TotalMilliseconds);
            }
            NativeLog.Write("Stopped the dashboard service started by this native UI.");
            return true;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
        finally
        {
            _process = null;
            process.Dispose();
        }
    }

    public void Dispose()
    {
        // The dashboard service owns the persistent WSL PTYs. Detaching the
        // native UI must not kill that service or its Codex processes; the
        // next native/browser client can reconnect to the same loopback port.
        _process?.Dispose();
    }
}
