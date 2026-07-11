using System.Diagnostics;
using CodexNative.Core;

namespace CodexNative.TerminalHost;

internal static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            if (args is ["--server-terminal", var endpoint])
            {
                HostLog.Write($"Starting persistent terminal bridge to {new Uri(endpoint).Authority}.");
                return TerminalBridge.RunAsync(new Uri(endpoint)).GetAwaiter().GetResult();
            }
            if (!OperatingSystem.IsWindows())
            {
                throw new PlatformNotSupportedException(
                    "WSL launch modes are available only in the Windows build.");
            }
            var request = NativeLaunchBuilder.ParseHostArguments(args);
            var spec = NativeLaunchBuilder.BuildWslSpec(request, Environment.SystemDirectory);
            var startInfo = new ProcessStartInfo
            {
                FileName = spec.Process,
                UseShellExecute = false,
            };

            foreach (var argument in spec.Arguments)
            {
                startInfo.ArgumentList.Add(argument);
            }

            PopulateWindowsEnvironment(startInfo);
            ForwardDashboardControlCapability(startInfo, request.Mode);
            HostLog.Write($"Starting {spec.Process} for {request.Mode} in {request.Distribution}.");

            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Windows did not start wsl.exe.");
            HostLog.Write($"wsl.exe started with PID {process.Id}.");
            process.WaitForExit();
            HostLog.Write($"wsl.exe exited with code {process.ExitCode}.");
            return process.ExitCode;
        }
        catch (Exception ex)
        {
            HostLog.Write($"Terminal host failed: {ex}");
            Console.Error.WriteLine($"CodexNative terminal host failed: {ex.Message}");
            return 1;
        }
    }

    private static void ForwardDashboardControlCapability(
        ProcessStartInfo startInfo,
        NativeLaunchMode mode)
    {
        if (mode != NativeLaunchMode.DashboardService) return;
        var capability = Environment.GetEnvironmentVariable(
            DashboardServiceOwnership.ControlCapabilityEnvironmentVariable);
        if (!DashboardServiceOwnership.IsValidControlCapability(capability))
            throw new InvalidOperationException("Dashboard service control capability is missing or invalid.");
        startInfo.Environment[DashboardServiceOwnership.ControlCapabilityEnvironmentVariable] = capability;
        var inherited = Environment.GetEnvironmentVariable("WSLENV");
        var entry = DashboardServiceOwnership.ControlCapabilityEnvironmentVariable;
        startInfo.Environment["WSLENV"] = string.IsNullOrWhiteSpace(inherited)
            ? entry
            : $"{inherited}:{entry}";
    }

    private static void PopulateWindowsEnvironment(ProcessStartInfo startInfo)
    {
        var windowsDirectory = Directory.GetParent(Environment.SystemDirectory)?.FullName
            ?? @"C:\Windows";
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var temporaryDirectory = Path.Combine(windowsDirectory, "Temp");

        startInfo.Environment["SystemRoot"] = windowsDirectory;
        startInfo.Environment["WINDIR"] = windowsDirectory;
        startInfo.Environment["COMSPEC"] = Path.Combine(Environment.SystemDirectory, "cmd.exe");
        startInfo.Environment["PATH"] = string.Join(';', new[]
        {
            Environment.SystemDirectory,
            windowsDirectory,
            Path.Combine(Environment.SystemDirectory, "Wbem"),
            Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0"),
        });
        startInfo.Environment["PATHEXT"] = ".COM;.EXE;.BAT;.CMD";
        startInfo.Environment["TEMP"] = temporaryDirectory;
        startInfo.Environment["TMP"] = temporaryDirectory;

        if (!string.IsNullOrWhiteSpace(userProfile))
        {
            startInfo.Environment["USERPROFILE"] = userProfile;
        }
        if (!string.IsNullOrWhiteSpace(localAppData))
        {
            startInfo.Environment["LOCALAPPDATA"] = localAppData;
        }
        if (!string.IsNullOrWhiteSpace(appData))
        {
            startInfo.Environment["APPDATA"] = appData;
        }
    }
}

internal static class HostLog
{
    public static void Write(string message)
    {
        try
        {
            var directory = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CodexNative");
            Directory.CreateDirectory(directory);
            var path = System.IO.Path.Combine(directory, "terminal-host.log");
            File.AppendAllText(path, $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}");
        }
        catch
        {
            // Diagnostics must never interfere with terminal startup.
        }
    }
}
