using System.Diagnostics;
using System.Net.Http.Json;
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
        NativeInstallLock? installLock = null;
        var parentExited = false;
        try
        {
            request = NativeInstallRequest.Parse(
                args,
                Environment.GetEnvironmentVariable(
                    DashboardServiceOwnership.ControlCapabilityEnvironmentVariable));
            UpdateLog.Write($"Preparing update from {request.SourcePayload} to {request.TargetDirectory}.");
            WaitForProcess(request.ParentProcessId, "native app", ProcessExitTimeout);
            parentExited = true;
            installLock = NativeInstallLock.Acquire(request.TargetDirectory, ProcessExitTimeout);
            WaitForRelatedProcesses(request);
            EnsureNoOtherInstallProcesses(request, request.DashboardServiceProcessId);
            QuiesceOwnedDashboardService(request);
            EnsureNoOtherInstallProcesses(request);
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
        finally
        {
            installLock?.Dispose();
        }
    }

    private static void WaitForRelatedProcesses(NativeInstallRequest request)
    {
        foreach (var processId in request.RelatedProcessIds ?? [])
            WaitForProcess(processId, "terminal bridge", TimeSpan.FromSeconds(15));
    }

    private static void EnsureNoOtherInstallProcesses(
        NativeInstallRequest request,
        int? ownedDashboardServiceProcessId = null)
    {
        var blockers = new List<string>();
        var seen = new HashSet<int>();
        foreach (var processName in new[]
                 {
                     "CodexNative",
                     "CodexNative.TerminalHost",
                     "CodexNative.Term",
                     "CodexNative.Ter",
                 })
        {
            foreach (var process in Process.GetProcessesByName(processName))
            {
                using (process)
                {
                    if (!seen.Add(process.Id)) continue;
                    string? executable;
                    try { executable = process.MainModule?.FileName; }
                    catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
                    {
                        continue;
                    }
                    if (NativeInstallProcessPolicy.IsUpdateBlocker(
                            request.Platform,
                            request.TargetDirectory,
                            process.Id,
                            executable,
                            ownedDashboardServiceProcessId))
                    {
                        blockers.Add($"{process.ProcessName} (PID {process.Id})");
                    }
                }
            }
        }
        if (blockers.Count > 0)
            throw new InvalidOperationException(
                $"Close the other Codex Native instance or terminal bridge and retry the update: {string.Join(", ", blockers)}. " +
                "No unrelated process was stopped.");
    }

    private static void WaitForProcess(
        int processId,
        string description,
        TimeSpan timeout)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            if (process.WaitForExit((int)timeout.TotalMilliseconds)) return;
            throw new TimeoutException(
                $"The {description} process {processId} did not exit within {timeout.TotalSeconds:0} seconds; " +
                "no process was stopped. Close it and retry the update.");
        }
        catch (ArgumentException)
        {
            // The process already exited between launching this helper and lookup.
        }
    }

    private static void QuiesceOwnedDashboardService(NativeInstallRequest request)
    {
        if (request.DashboardServiceProcessId is not { } serviceProcessId
            || request.DashboardServiceStartTimeUnixMilliseconds is not { } serviceStartTime
            || request.DashboardEndpoint is null
            || request.DashboardInstanceId is null
            || request.DashboardControlCapability is null)
            throw new InvalidOperationException(
                "The update did not include a verified owned dashboard service handoff; retry from Codex Native.");

        using var process = GetOwnedDashboardProcess(request, serviceProcessId, serviceStartTime);
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            DashboardServiceOwnership.ControlCapabilityHeader,
            request.DashboardControlCapability);
        var endpoint = new Uri(request.DashboardEndpoint, UriKind.Absolute);
        NativeDashboardUpdatePolicy.RevalidateThenStopAsync(
            request.DashboardInstanceId,
            async cancellationToken =>
            {
                var compatibility = await client.GetFromJsonAsync<DashboardCompatibilityResponse>(
                    new Uri(endpoint, "native/update-readiness"), cancellationToken)
                    ?? throw new InvalidOperationException(
                        "The owned dashboard service returned an empty compatibility response; no process was stopped.");
                return compatibility.Service == "ui-my-cli-dashboard"
                    ? DashboardApiProbeResult.FromResponse(
                        compatibility.Ok,
                        compatibility.ApiVersion,
                        compatibility.ActivePtys,
                        compatibility.InstanceId,
                        compatibility.ControlAuthenticated,
                        compatibility.BlockingSessions,
                        compatibility.ActivityCheckOk)
                    : DashboardApiProbeResult.Unreachable();
            },
            async cancellationToken =>
            {
                using var response = await client.PostAsJsonAsync(
                    new Uri(endpoint, "native/shutdown"),
                    new { instanceId = request.DashboardInstanceId },
                    cancellationToken);
                if (response.IsSuccessStatusCode) return;
                var detail = await response.Content.ReadAsStringAsync(cancellationToken);
                throw new InvalidOperationException(
                    $"The owned dashboard service refused the update shutdown ({(int)response.StatusCode}): {detail}");
            }).GetAwaiter().GetResult();
        client.Dispose();

        UpdateLog.Write($"Waiting for owned dashboard service PID {serviceProcessId} to stop gracefully.");
        if (!process.WaitForExit((int)TimeSpan.FromSeconds(15).TotalMilliseconds))
            throw new TimeoutException(
                $"The owned dashboard service PID {serviceProcessId} did not stop within 15 seconds; " +
                "no process was terminated. Retry the update after the service exits.");
    }

    private static Process GetOwnedDashboardProcess(
        NativeInstallRequest request,
        int serviceProcessId,
        long expectedStartTime)
    {
        Process process;
        try { process = Process.GetProcessById(serviceProcessId); }
        catch (ArgumentException ex)
        {
            throw new InvalidOperationException(
                $"The owned dashboard service PID {serviceProcessId} exited before update handoff; retry the update.", ex);
        }
        try
        {
            string? executable;
            try { executable = process.MainModule?.FileName; }
            catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                throw new InvalidOperationException(
                    $"Could not verify owned dashboard service PID {serviceProcessId}; no process was stopped.", ex);
            }
            if (!NativeInstallProcessPolicy.IsVerifiedOwnedDashboardService(
                    request.Platform,
                    request.TargetDirectory,
                    serviceProcessId,
                    process.Id,
                    executable,
                    expectedStartTime,
                    new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()))
                throw new InvalidOperationException(
                    $"Dashboard service PID {serviceProcessId} is not the owned service for this installation; " +
                    "no process was stopped.");
            return process;
        }
        catch
        {
            process.Dispose();
            throw;
        }
    }

    private sealed record DashboardCompatibilityResponse(
        bool Ok,
        int ApiVersion,
        string Service,
        string? InstanceId,
        int ActivePtys,
        int BlockingSessions,
        bool ActivityCheckOk,
        bool ControlAuthenticated);

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
        DateTimeOffset? restartRequestedAt = null;
        if (request.Platform == NativePlatform.Windows)
        {
            startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(request.TargetDirectory, "CodexNative.exe"),
                UseShellExecute = true,
                WorkingDirectory = request.TargetDirectory,
            };
            startInfo.ArgumentList.Add(NativeInstallLock.AuthorizedRestartArgument);
        }
        else
        {
            restartRequestedAt = DateTimeOffset.UtcNow;
            startInfo = new ProcessStartInfo
            {
                FileName = "/usr/bin/open",
                UseShellExecute = false,
            };
            startInfo.ArgumentList.Add("-n");
            startInfo.ArgumentList.Add(request.TargetDirectory);
            startInfo.ArgumentList.Add("--args");
            startInfo.ArgumentList.Add(NativeInstallLock.AuthorizedRestartArgument);
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
            if (IsMainApplicationRunning(request, restartRequestedAt!.Value)) return;
            Thread.Sleep(TimeSpan.FromMilliseconds(250));
        }
        throw new InvalidOperationException("macOS accepted the open request, but Codex Native did not remain running.");
    }

    private static bool IsMainApplicationRunning(
        NativeInstallRequest request,
        DateTimeOffset startedAfter)
    {
        foreach (var candidate in Process.GetProcessesByName("CodexNative"))
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
                        executable)
                    && ProcessStartedAt(candidate) >= startedAfter) return true;
            }
        }
        return false;

        static DateTimeOffset ProcessStartedAt(Process process)
        {
            try { return new DateTimeOffset(process.StartTime.ToUniversalTime()); }
            catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                return DateTimeOffset.MinValue;
            }
        }
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
