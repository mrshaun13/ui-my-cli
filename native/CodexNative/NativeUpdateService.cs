using System.Diagnostics;
using System.Reflection;
using CodexNative.Core;

namespace CodexNative;

public sealed class NativeUpdateService : IDisposable
{
    private readonly GitHubReleaseClient _releaseClient = new();
    private readonly NativeUpdatePackage _package = new();

    public NativeVersion CurrentVersion
    {
        get
        {
            var version = Assembly.GetEntryAssembly()?.GetName().Version;
            return new NativeVersion(version?.Major ?? 0, version?.Minor ?? 0, version?.Build ?? 0);
        }
    }

    public bool CanSelfUpdate(NativePlatformProfile platform)
    {
        try
        {
            _ = NativeInstallLayout.FindCurrentInstallDirectory(platform.Platform, AppContext.BaseDirectory);
            return File.Exists(Path.Combine(AppContext.BaseDirectory, platform.Platform == NativePlatform.Windows
                ? "CodexNative.Updater.exe"
                : "CodexNative.Updater"));
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    public void CleanupPreviousInstall(NativePlatformProfile platform)
    {
        try
        {
            var current = NativeInstallLayout.FindCurrentInstallDirectory(platform.Platform, AppContext.BaseDirectory);
            var previous = $"{current}.previous";
            if (Directory.Exists(previous)) Directory.Delete(previous, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            NativeLog.Write($"Previous native install cleanup deferred: {ex.Message}");
        }
    }

    public Task<NativeReleaseInfo?> CheckAsync(
        NativePlatformProfile platform,
        CancellationToken cancellationToken = default) =>
        _releaseClient.GetLatestAsync(CurrentVersion, platform.ReleaseRuntimeIdentifier, cancellationToken);

    public Task<PreparedNativeUpdate> PrepareAsync(
        NativeReleaseInfo release,
        NativePlatformProfile platform,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default) =>
        _package.PrepareAsync(
            release,
            platform,
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CodexNative",
                "updates"),
            progress,
            cancellationToken);

    public Process LaunchInstaller(PreparedNativeUpdate update, NativePlatformProfile platform)
    {
        var target = NativeInstallLayout.FindCurrentInstallDirectory(
            platform.Platform,
            AppContext.BaseDirectory);
        var request = new NativeInstallRequest(
            Environment.ProcessId,
            platform.Platform,
            update.PayloadDirectory,
            target);
        var startInfo = new ProcessStartInfo
        {
            FileName = update.InstallerExecutable,
            UseShellExecute = false,
            WorkingDirectory = update.StagingDirectory,
            CreateNoWindow = true,
        };
        foreach (var argument in request.ToArguments()) startInfo.ArgumentList.Add(argument);
        return Process.Start(startInfo)
            ?? throw new InvalidOperationException("The operating system did not start the update installer.");
    }

    public void Dispose()
    {
        _package.Dispose();
        _releaseClient.Dispose();
    }
}
