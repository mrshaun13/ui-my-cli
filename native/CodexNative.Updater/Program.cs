using System.Diagnostics;
using CodexNative.Core;

namespace CodexNative.Updater;

internal static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            var request = NativeInstallRequest.Parse(args);
            UpdateLog.Write($"Preparing update from {request.SourcePayload} to {request.TargetDirectory}.");
            WaitForParent(request.ParentProcessId);
            var hadPreviousInstall = Install(request);
            try
            {
                Restart(request);
            }
            catch
            {
                RestorePreviousInstall(request.TargetDirectory, hadPreviousInstall);
                throw;
            }
            UpdateLog.Write("Update installed and restart launched.");
            return 0;
        }
        catch (Exception ex)
        {
            UpdateLog.Write($"Update failed: {ex}");
            return 1;
        }
    }

    private static void WaitForParent(int parentProcessId)
    {
        try
        {
            using var parent = Process.GetProcessById(parentProcessId);
            if (!parent.WaitForExit((int)TimeSpan.FromMinutes(2).TotalMilliseconds))
                throw new TimeoutException("The native app did not exit within two minutes.");
        }
        catch (ArgumentException)
        {
            // The app already exited between launching this helper and lookup.
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
            TryDeleteDirectory(backup);
            if (Directory.Exists(target))
            {
                Directory.Move(target, backup);
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
        if (request.Platform == NativePlatform.MacOS
            && process.WaitForExit((int)TimeSpan.FromSeconds(10).TotalMilliseconds)
            && process.ExitCode != 0)
            throw new InvalidOperationException($"macOS rejected the app restart with exit code {process.ExitCode}.");
    }

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
