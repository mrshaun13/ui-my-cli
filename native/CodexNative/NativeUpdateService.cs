using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using CodexNative.Core;

namespace CodexNative;

public sealed class NativeUpdateService : IDisposable
{
    private readonly GitHubReleaseClient _releaseClient = new();
    private readonly NativeUpdatePackage _package = new();
    private readonly SemaphoreSlim _checkLock = new(1, 1);
    private readonly string _cachePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "CodexNative",
        "update-cache.json");
    private NativeUpdateCacheEntry? _cache;
    private bool _cacheLoaded;

    private static readonly TimeSpan CheckFreshness = TimeSpan.FromMinutes(30);

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
            if (NativeUpdateInstallationState.IsInProgress(current)) return;
            var previous = $"{current}.previous";
            if (Directory.Exists(previous)) Directory.Delete(previous, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            NativeLog.Write($"Previous native install cleanup deferred: {ex.Message}");
        }
    }

    public async Task<NativeReleaseInfo?> CheckAsync(
        NativePlatformProfile platform,
        bool force = false,
        CancellationToken cancellationToken = default)
    {
        await _checkLock.WaitAsync(cancellationToken);
        try
        {
            LoadCache();
            var now = DateTimeOffset.UtcNow;
            var runtime = platform.ReleaseRuntimeIdentifier;
            if (_cache?.RateLimitedUntil is { } retryAt && retryAt > now)
                throw new GitHubRateLimitException(retryAt);
            if (!force
                && _cache is { } fresh
                && fresh.RuntimeIdentifier == runtime
                && fresh.Release is not null
                && fresh.CheckedAt <= now.AddMinutes(5)
                && now - fresh.CheckedAt <= CheckFreshness)
                return NewerThanCurrent(fresh.Release);

            var entityTag = _cache is { RuntimeIdentifier: var cachedRuntime, Release: not null }
                && cachedRuntime == runtime
                    ? _cache.EntityTag
                    : null;
            if (GitHubReleaseClient.SanitizeEntityTag(entityTag) is null)
                entityTag = null;
            try
            {
                var query = await _releaseClient.QueryLatestAsync(
                    runtime,
                    entityTag,
                    cancellationToken);
                var release = query.NotModified ? _cache?.Release : query.Release;
                _cache = new NativeUpdateCacheEntry(
                    runtime,
                    now,
                    RateLimitedUntil: null,
                    query.EntityTag ?? entityTag,
                    release);
                SaveCache();
                return NewerThanCurrent(release);
            }
            catch (GitHubRateLimitException ex)
            {
                _cache = new NativeUpdateCacheEntry(
                    runtime,
                    _cache?.CheckedAt ?? DateTimeOffset.MinValue,
                    ex.RetryAt,
                    entityTag,
                    _cache?.Release);
                SaveCache();
                throw;
            }
        }
        finally
        {
            _checkLock.Release();
        }
    }

    private NativeReleaseInfo? NewerThanCurrent(NativeReleaseInfo? release) =>
        release is not null && release.Version > CurrentVersion ? release : null;

    private void LoadCache()
    {
        if (_cacheLoaded) return;
        _cacheLoaded = true;
        try
        {
            if (!File.Exists(_cachePath)) return;
            var info = new FileInfo(_cachePath);
            if (info.Length is <= 0 or > 64 * 1024) return;
            _cache = JsonSerializer.Deserialize<NativeUpdateCacheEntry>(File.ReadAllText(_cachePath));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            NativeLog.Write($"Ignoring invalid native update cache: {ex.Message}");
        }
    }

    private void SaveCache()
    {
        if (_cache is null) return;
        try
        {
            var directory = Path.GetDirectoryName(_cachePath)!;
            Directory.CreateDirectory(directory);
            var temporary = $"{_cachePath}.{Environment.ProcessId}.tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(_cache));
            File.Move(temporary, _cachePath, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            NativeLog.Write($"Native update cache write deferred: {ex.Message}");
        }
    }

    private sealed record NativeUpdateCacheEntry(
        string RuntimeIdentifier,
        DateTimeOffset CheckedAt,
        DateTimeOffset? RateLimitedUntil,
        string? EntityTag,
        NativeReleaseInfo? Release);

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

    public Process LaunchInstaller(
        PreparedNativeUpdate update,
        NativePlatformProfile platform,
        IEnumerable<int>? relatedProcessIds = null)
    {
        var target = NativeInstallLayout.FindCurrentInstallDirectory(
            platform.Platform,
            AppContext.BaseDirectory);
        var request = new NativeInstallRequest(
            Environment.ProcessId,
            platform.Platform,
            update.PayloadDirectory,
            target,
            relatedProcessIds?
                .Where(processId => processId > 0 && processId != Environment.ProcessId)
                .Distinct()
                .ToArray());
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
        _checkLock.Dispose();
    }
}
