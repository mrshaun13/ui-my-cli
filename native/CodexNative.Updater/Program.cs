using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using CodexNative.Core;

namespace CodexNative.Updater;

internal static class Program
{
    private static readonly TimeSpan ProcessExitTimeout = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan InstallRetryTimeout = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan RestartHealthWindow = TimeSpan.FromSeconds(5);

    private static int Main(string[] args)
    {
        NativeInstallRequest? request = null;
        var parentExited = false;
        try
        {
            request = NativeInstallRequest.Parse(args);
            UpdateLog.Write($"Preparing update from {request.SourcePayload} to {request.TargetDirectory}.");
            WaitForProcesses(request);
            parentExited = true;
            EnsureNoUnrelatedInstallProcesses(request);
            QuiesceRelatedTerminalHosts(request);
            EnsureNoUnrelatedInstallProcesses(request);
            var hadPreviousInstall = Install(request);
            try
            {
                VerifyInstalledVersion(request);
                NativeUpdateInstallationState.MarkInProgress(request.TargetDirectory);
                WriteResult(
                    succeeded: true,
                    $"Codex Native {UpdaterVersion()} installed successfully.");
                Restart(request);
            }
            catch
            {
                RestorePreviousInstall(request.TargetDirectory, hadPreviousInstall);
                throw;
            }
            try
            {
                NativeUpdateInstallationState.Clear(request.TargetDirectory);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
            {
                UpdateLog.Write($"Previous install cleanup marker retained: {ex.Message}");
            }
            UpdateLog.Write("Update installed and restart launched.");
            return 0;
        }
        catch (Exception ex)
        {
            UpdateLog.Write($"Update failed: {ex}");
            var failureMessage = FailureMessage(ex);
            if (request is not null)
            {
                WriteResult(
                    succeeded: false,
                    failureMessage);
                if (parentExited) TryRestartPreviousInstall(request);
                ShowFailure(request.Platform, failureMessage);
            }
            return 1;
        }
    }

    private static void WaitForProcesses(NativeInstallRequest request)
    {
        WaitForProcess(request.ParentProcessId, "native app", ProcessExitTimeout, failOnTimeout: true);
        foreach (var processId in request.RelatedProcessIds ?? [])
            WaitForProcess(processId, "terminal host", TimeSpan.FromSeconds(5), failOnTimeout: false);
    }

    private static void WaitForProcess(
        int processId,
        string description,
        TimeSpan timeout,
        bool failOnTimeout)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            if (process.WaitForExit((int)timeout.TotalMilliseconds)) return;
            if (failOnTimeout)
                throw new TimeoutException(
                    $"The {description} process {processId} did not exit within {timeout.TotalSeconds:0} seconds.");
            UpdateLog.Write(
                $"The {description} process {processId} is still running; validating ownership before forced cleanup.");
        }
        catch (ArgumentException)
        {
            // The process already exited between launching this helper and lookup.
        }
    }

    private static void EnsureNoUnrelatedInstallProcesses(NativeInstallRequest request)
    {
        var relatedProcessIds = (request.RelatedProcessIds ?? []).ToHashSet();
        var blockers = new List<string>();
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                if (process.Id == Environment.ProcessId) continue;
                string? executable;
                try { executable = process.MainModule?.FileName; }
                catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
                {
                    continue;
                }
                if (!NativeInstallProcessPolicy.IsBlockingInstallProcess(
                        request.Platform,
                        request.TargetDirectory,
                        request.ParentProcessId,
                        relatedProcessIds,
                        process.Id,
                        executable)) continue;

                var kind = NativeInstallProcessPolicy.IsMainApplication(
                    request.Platform,
                    request.TargetDirectory,
                    executable)
                    ? "Codex Native app"
                    : "terminal host";
                blockers.Add($"{kind} PID {process.Id}");
            }
        }

        if (blockers.Count > 0)
            throw new InvalidOperationException(
                $"Close the other {string.Join(" and ", blockers)} before retrying the update; " +
                "no unrelated process was stopped.");
    }

    private static void QuiesceRelatedTerminalHosts(NativeInstallRequest request)
    {
        var relatedProcessIds = (request.RelatedProcessIds ?? []).ToHashSet();
        foreach (var processId in relatedProcessIds)
        {
            Process? process = null;
            try
            {
                process = Process.GetProcessById(processId);
                string? executable;
                try { executable = process.MainModule?.FileName; }
                catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
                {
                    throw new InvalidOperationException(
                        $"Could not verify terminal host PID {processId}; no process was stopped.", ex);
                }
                if (!NativeInstallProcessPolicy.CanTerminateRelatedTerminalHost(
                        request.Platform,
                        request.TargetDirectory,
                        processId,
                        relatedProcessIds,
                        executable))
                    throw new InvalidOperationException(
                        $"Related PID {processId} is not a terminal host from this Codex Native installation; " +
                        "no process was stopped.");

                UpdateLog.Write($"Waiting for related terminal host PID {process.Id} to release the installation.");
                try
                {
                    if (process.WaitForExit((int)TimeSpan.FromSeconds(5).TotalMilliseconds)) continue;
                    UpdateLog.Write($"Stopping verified related terminal host PID {process.Id} before installation.");
                    process.Kill(entireProcessTree: true);
                    if (!process.WaitForExit((int)TimeSpan.FromSeconds(10).TotalMilliseconds))
                        throw new TimeoutException($"Related terminal host PID {process.Id} did not stop.");
                }
                catch (InvalidOperationException)
                {
                    if (!process.HasExited) throw;
                }
            }
            catch (ArgumentException)
            {
            }
            finally
            {
                process?.Dispose();
            }
        }
    }

    private static bool Install(NativeInstallRequest request)
    {
        var target = request.TargetDirectory;
        var source = request.Platform == NativePlatform.Windows
            ? request.SourcePayload
            : Path.Combine(request.SourcePayload, "CodexNative.app");
        if (!Directory.Exists(source))
            throw new DirectoryNotFoundException("The staged update payload no longer exists.");

        var parentDirectory = Directory.GetParent(target)?.FullName
            ?? throw new InvalidOperationException("The installation directory has no parent.");
        var installStaging = Path.Combine(parentDirectory, $".codex-native-install-{Guid.NewGuid():N}");
        var backup = $"{target}.previous";
        TryDeleteDirectory(installStaging);

        var targetMoved = false;
        try
        {
            CopyDirectory(source, installStaging);
            RetryFileOperation(() => TryDeleteDirectory(backup), "remove the previous update backup");
            if (Directory.Exists(target))
            {
                RetryFileOperation(() => Directory.Move(target, backup), "quiesce and move the current installation");
                targetMoved = true;
            }
            Directory.Move(installStaging, target);
            return targetMoved;
        }
        catch
        {
            TryDeleteDirectory(installStaging);
            if (targetMoved && !Directory.Exists(target) && Directory.Exists(backup))
                Directory.Move(backup, target);
            throw;
        }
    }

    private static void RestorePreviousInstall(string target, bool hadPreviousInstall)
    {
        var backup = $"{target}.previous";
        TryDeleteDirectory(target);
        if (hadPreviousInstall && Directory.Exists(backup)) Directory.Move(backup, target);
    }

    private static void Restart(NativeInstallRequest request)
    {
        ProcessStartInfo startInfo;
        if (request.Platform == NativePlatform.Windows)
        {
            startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(request.TargetDirectory, "CodexNative.exe"),
                UseShellExecute = true,
                WorkingDirectory = request.TargetDirectory,
            };
        }
        else
        {
            startInfo = new ProcessStartInfo
            {
                FileName = "/usr/bin/open",
                UseShellExecute = false,
            };
            startInfo.ArgumentList.Add("-n");
            startInfo.ArgumentList.Add(request.TargetDirectory);
        }

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The operating system did not restart Codex Native.");
        if (request.Platform == NativePlatform.Windows)
        {
            if (process.WaitForExit((int)RestartHealthWindow.TotalMilliseconds))
                throw new InvalidOperationException(
                    $"The restarted Codex Native process exited during its startup health window with code {process.ExitCode}.");
            return;
        }
        if (process.WaitForExit((int)TimeSpan.FromSeconds(10).TotalMilliseconds)
            && process.ExitCode != 0)
            throw new InvalidOperationException($"macOS rejected the app restart with exit code {process.ExitCode}.");
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < TimeSpan.FromSeconds(10))
        {
            if (IsMainApplicationRunning(request)) return;
            Thread.Sleep(TimeSpan.FromMilliseconds(250));
        }
        throw new InvalidOperationException("macOS accepted the open request, but Codex Native did not remain running.");
    }

    private static bool IsMainApplicationRunning(NativeInstallRequest request)
    {
        foreach (var candidate in Process.GetProcesses())
        {
            using (candidate)
            {
                string? executable;
                try { executable = candidate.MainModule?.FileName; }
                catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
                {
                    continue;
                }
                if (NativeInstallProcessPolicy.IsMainApplication(
                        request.Platform,
                        request.TargetDirectory,
                        executable)) return true;
            }
        }
        return false;
    }

    private static void VerifyInstalledVersion(NativeInstallRequest request)
    {
        var executable = request.Platform == NativePlatform.Windows
            ? Path.Combine(request.TargetDirectory, "CodexNative.exe")
            : Path.Combine(request.TargetDirectory, "Contents", "MacOS", "CodexNative");
        if (!File.Exists(executable))
            throw new InvalidDataException("The installed update does not contain the Codex Native executable.");

        var expected = Assembly.GetExecutingAssembly().GetName().Version
            ?? throw new InvalidOperationException("The updater version is unavailable.");
        var installedInfo = FileVersionInfo.GetVersionInfo(executable);
        if (installedInfo.FileMajorPart != expected.Major
            || installedInfo.FileMinorPart != expected.Minor
            || installedInfo.FileBuildPart != expected.Build)
            throw new InvalidDataException(
                $"Installed version {installedInfo.FileVersion ?? "unknown"} does not match updater version " +
                $"{expected.Major}.{expected.Minor}.{expected.Build}.");
    }

    private static string UpdaterVersion()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version
            ?? throw new InvalidOperationException("The updater version is unavailable.");
        return $"{version.Major}.{version.Minor}.{version.Build}";
    }

    private static void WriteResult(bool succeeded, string message)
    {
        try
        {
            NativeUpdateResultStore.Write(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                new NativeUpdateResult(succeeded, UpdaterVersion(), message, DateTimeOffset.UtcNow));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            UpdateLog.Write($"Could not persist update result: {ex.Message}");
        }
    }

    private static void RetryFileOperation(Action operation, string description)
    {
        var deadline = Stopwatch.StartNew();
        var attempt = 0;
        while (true)
        {
            try
            {
                operation();
                if (attempt > 0) UpdateLog.Write($"Succeeded on retry {attempt + 1} to {description}.");
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                attempt++;
                if (deadline.Elapsed >= InstallRetryTimeout)
                    throw new IOException($"Unable to {description} within {InstallRetryTimeout.TotalSeconds:0} seconds.", ex);
                var delay = TimeSpan.FromMilliseconds(Math.Min(2000, 200 * Math.Pow(1.6, attempt - 1)));
                UpdateLog.Write(
                    $"Retry {attempt} to {description} after transient filesystem error: {ex.Message}");
                Thread.Sleep(delay);
            }
        }
    }

    private static void TryRestartPreviousInstall(NativeInstallRequest request)
    {
        try
        {
            var executable = request.Platform == NativePlatform.Windows
                ? Path.Combine(request.TargetDirectory, "CodexNative.exe")
                : request.TargetDirectory;
            if (request.Platform == NativePlatform.Windows && !File.Exists(executable)) return;
            if (request.Platform == NativePlatform.MacOS && !Directory.Exists(executable)) return;
            Restart(request);
            UpdateLog.Write("Relaunched the previous Codex Native installation after update failure.");
        }
        catch (Exception restartError)
        {
            UpdateLog.Write($"Could not relaunch the previous installation: {restartError}");
        }
    }

    private static string FailureMessage(Exception error)
    {
        var detail = new string(error.Message
            .Select(character => char.IsControl(character) ? ' ' : character)
            .ToArray());
        if (detail.Length > 1600) detail = detail[..1600];
        return $"Codex Native could not install the update. The previous installation was preserved. {detail}";
    }

    private static void ShowFailure(NativePlatform platform, string message)
    {
        try
        {
            if (platform == NativePlatform.Windows)
            {
                _ = MessageBoxW(IntPtr.Zero, message, "Codex Native Update Failed", 0x10);
                return;
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = "/usr/bin/osascript",
                UseShellExecute = false,
                RedirectStandardInput = true,
                CreateNoWindow = true,
            };
            startInfo.ArgumentList.Add("-");
            startInfo.ArgumentList.Add(message);
            var process = Process.Start(startInfo);
            if (process is null) return;
            process.StandardInput.Write(
                "on run argv\n" +
                "display alert \"Codex Native Update Failed\" message (item 1 of argv) as critical\n" +
                "end run\n");
            process.StandardInput.Close();
            process.Dispose();
        }
        catch (Exception ex)
        {
            UpdateLog.Write($"Could not display update failure: {ex.Message}");
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr window, string text, string caption, uint type);

    private static void CopyDirectory(string source, string destination)
    {
        var pending = new Stack<(string Source, string Destination)>();
        pending.Push((source, destination));
        while (pending.Count > 0)
        {
            var current = pending.Pop();
            var directoryInfo = new DirectoryInfo(current.Source);
            if ((directoryInfo.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Update payload contains a directory reparse point.");
            Directory.CreateDirectory(current.Destination);
            foreach (var entry in Directory.EnumerateFileSystemEntries(current.Source))
            {
                var attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("Update payload contains a reparse point.");
                var target = Path.Combine(current.Destination, Path.GetFileName(entry));
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    pending.Push((entry, target));
                    continue;
                }
                File.Copy(entry, target, overwrite: false);
                if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(target, File.GetUnixFileMode(entry));
            }
        }
    }

    private static void TryDeleteDirectory(string path)
    {
        try { Directory.Delete(path, recursive: true); }
        catch (DirectoryNotFoundException) { }
    }
}

internal static class UpdateLog
{
    public static void Write(string message)
    {
        try
        {
            var directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CodexNative");
            Directory.CreateDirectory(directory);
            File.AppendAllText(
                Path.Combine(directory, "updater.log"),
                $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}");
        }
        catch
        {
            // Update behavior must not depend on diagnostic storage.
        }
    }
}
