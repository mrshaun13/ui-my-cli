using System.Diagnostics;
using CodexNative.Core;

namespace CodexNative;

public sealed class DashboardServiceManager : IDisposable
{
    private Process? _process;

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
        string? nodeExecutable = null)
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
            nodeExecutable);
        var startInfo = new ProcessStartInfo
        {
            FileName = spec.Process,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = spec.WorkingDirectory ?? string.Empty,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
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
            $"Starting dashboard service with '{spec.Process}' in '{startInfo.WorkingDirectory}'.");
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

    public void Dispose()
    {
        // The dashboard service owns the persistent WSL PTYs. Detaching the
        // native UI must not kill that service or its Codex processes; the
        // next native/browser client can reconnect to the same loopback port.
        _process?.Dispose();
    }
}
