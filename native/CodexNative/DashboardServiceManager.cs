using System.Diagnostics;
using CodexNative.Core;

namespace CodexNative;

public sealed class DashboardServiceManager : IDisposable
{
    private Process? _process;

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
        };
        foreach (var argument in spec.Arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }
        foreach (var variable in spec.Environment ?? new Dictionary<string, string>())
        {
            startInfo.Environment[variable.Key] = variable.Value;
        }

        _process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The operating system did not start the dashboard data service.");
        NativeLog.Write($"Dashboard service host started with PID {_process.Id}.");
    }

    public void Dispose()
    {
        // The dashboard service owns the persistent WSL PTYs. Detaching the
        // native UI must not kill that service or its Codex processes; the
        // next native/browser client can reconnect to the same loopback port.
        _process?.Dispose();
    }
}
