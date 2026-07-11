using System.Diagnostics;
using CodexNative.Core;

namespace CodexNative;

public sealed class DashboardServiceManager : IDisposable
{
    private Process? _process;
    private int? _ownedPort;
    private string? _ownedInstanceId;
    private string? _controlCapability;
    private long? _processStartTimeUnixMilliseconds;

    public int? OwnedPort => OwnsRunningService ? _ownedPort : null;
    public int? OwnedProcessId => OwnsRunningService ? _process?.Id : null;
    public string? OwnedInstanceId => OwnsRunningService ? _ownedInstanceId : null;
    public DashboardServiceOwnership? Ownership =>
        OwnsRunningService
        && _process is not null
        && _ownedPort is { } port
        && _ownedInstanceId is { } instanceId
        && _controlCapability is { } controlCapability
        && _processStartTimeUnixMilliseconds is { } processStartTime
            ? new DashboardServiceOwnership(
                _process.Id,
                processStartTime,
                port,
                instanceId,
                controlCapability)
            : null;

    public bool OwnsServiceOnPort(int port) =>
        OwnsRunningService && _ownedPort == port;

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

    public DashboardServiceOwnership EnsureStarted(
        NativePlatform platform,
        string hostExecutable,
        string distribution,
        string dashboardDirectory,
        string? nodeExecutable = null,
        int port = DashboardServicePorts.FirstPrivate)
    {
        if (_process is { HasExited: false })
        {
            return Ownership
                ?? throw new InvalidOperationException("Dashboard service ownership is incomplete.");
        }

        var instanceId = Guid.NewGuid().ToString("D");
        var controlCapability = DashboardServiceOwnership.CreateControlCapability();
        var spec = NativeLaunchBuilder.DashboardService(
            platform,
            hostExecutable,
            distribution,
            dashboardDirectory,
            nodeExecutable,
            port,
            instanceId);
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
        startInfo.Environment[DashboardServiceOwnership.ControlCapabilityEnvironmentVariable] = controlCapability;

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
        _ownedPort = port;
        _ownedInstanceId = instanceId;
        _controlCapability = controlCapability;
        _processStartTimeUnixMilliseconds = new DateTimeOffset(process.StartTime.ToUniversalTime())
            .ToUnixTimeMilliseconds();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        NativeLog.Write($"Dashboard service host started with PID {process.Id}.");
        return Ownership
            ?? throw new InvalidOperationException("Dashboard service ownership could not be recorded.");
    }

    public bool TryAdopt(
        NativePlatform platform,
        string targetDirectory,
        DashboardServiceOwnership ownership)
    {
        if (!ownership.IsStructurallyValid()) return false;
        Process? process = null;
        try
        {
            process = Process.GetProcessById(ownership.ProcessId);
            var executable = process.MainModule?.FileName;
            var startTime = new DateTimeOffset(process.StartTime.ToUniversalTime())
                .ToUnixTimeMilliseconds();
            if (!NativeInstallProcessPolicy.IsVerifiedOwnedDashboardService(
                    platform,
                    targetDirectory,
                    ownership.ProcessId,
                    process.Id,
                    executable,
                    ownership.ProcessStartTimeUnixMilliseconds,
                    startTime))
            {
                process.Dispose();
                return false;
            }

            process.EnableRaisingEvents = true;
            _process?.Dispose();
            _process = process;
            _ownedPort = ownership.Port;
            _ownedInstanceId = ownership.InstanceId;
            _controlCapability = ownership.ControlCapability;
            _processStartTimeUnixMilliseconds = ownership.ProcessStartTimeUnixMilliseconds;
            process = null;
            NativeLog.Write($"Re-adopted dashboard service host PID {ownership.ProcessId} on port {ownership.Port}.");
            return true;
        }
        catch (Exception ex) when (ex is ArgumentException
            or InvalidOperationException
            or System.ComponentModel.Win32Exception)
        {
            process?.Dispose();
            NativeLog.Write($"Dashboard service re-adoption rejected: {ex.Message}");
            return false;
        }
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
                if (!process.WaitForExit((int)TimeSpan.FromSeconds(5).TotalMilliseconds)
                    && !process.HasExited)
                {
                    NativeLog.Write("Dashboard service did not exit within the stop timeout; retaining ownership.");
                    return false;
                }
            }
            NativeLog.Write("Stopped the dashboard service started by this native UI.");
            ClearOwnedProcess(process);
            return true;
        }
        catch (Exception ex)
        {
            try
            {
                if (process.HasExited)
                {
                    NativeLog.Write("Stopped the dashboard service started by this native UI.");
                    ClearOwnedProcess(process);
                    return true;
                }
            }
            catch (Exception)
            {
            }
            NativeLog.Write($"Failed to stop the dashboard service ({ex.GetType().Name}: {ex.Message}); retaining ownership for a later retry.");
            return false;
        }
    }

    private void ClearOwnedProcess(Process process)
    {
        if (ReferenceEquals(_process, process))
        {
            _process = null;
            _ownedPort = null;
            _ownedInstanceId = null;
            _controlCapability = null;
            _processStartTimeUnixMilliseconds = null;
        }
        process.Dispose();
    }

    public void ReleaseOwnership()
    {
        _process?.Dispose();
        _process = null;
        _ownedPort = null;
        _ownedInstanceId = null;
        _controlCapability = null;
        _processStartTimeUnixMilliseconds = null;
    }

    public void Dispose()
    {
        // The dashboard service owns the persistent WSL PTYs. Detaching the
        // native UI must not kill that service or its Codex processes; the
        // next native/browser client can reconnect to the same loopback port.
        ReleaseOwnership();
    }
}
