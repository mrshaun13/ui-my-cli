using System.Text.Json;
using System.Text.Json.Serialization;
using CodexNative.Core;

namespace CodexNative;

public sealed record NativeSettings(
    string Distribution,
    string WorkingDirectory,
    string StyleId = "signal",
    string TextSizeId = "standard",
    string DashboardWorkingDirectory = "/home/user/ui-my-cli",
    List<string>? OpenSessionIds = null,
    string? ActiveSessionId = null,
    bool SidebarCollapsed = false,
    string? SelectedRepo = null,
    bool ShowHeadless = true,
    bool IncludeArchived = false,
    int ColdDays = 3,
    string SearchQuery = "",
    bool NeedsInputOnly = false,
    double SidebarWidth = 310,
    List<string>? SelectedRepos = null,
    string AnalyticsWindow = "7d",
    string StatsMode = "combined",
    List<NativePaneLayout>? PaneLayouts = null,
    string? ActivePaneId = null,
    string? ScreenshotCaptureDirectory = null,
    int ScreenshotRetentionDays = 3,
    int ScreenshotMaximumMegapixels = 32,
    string ProviderId = "codex")
{
    public static NativeSettings Default { get; } = CreateDefault();

    private static NativeSettings CreateDefault()
    {
        if (!OperatingSystem.IsWindows())
        {
            var unixHome = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var dashboardDirectory = DashboardRepositoryLocator.Find(
                AppContext.BaseDirectory,
                unixHome,
                Environment.GetEnvironmentVariable("UI_MY_CLI_HOME"));
            return new NativeSettings(
                "Ubuntu",
                unixHome,
                DashboardWorkingDirectory: dashboardDirectory);
        }

        var windowsUser = Environment.UserName;
        var wslUser = windowsUser.Length is > 0 and <= 32
            && windowsUser.All(character => char.IsAsciiLetterOrDigit(character)
                || character is '-' or '_' or '.')
                ? windowsUser
                : "user";
        var home = $"/home/{wslUser}";
        return new NativeSettings("Ubuntu", home, DashboardWorkingDirectory: $"{home}/ui-my-cli");
    }

    [JsonIgnore]
    public IReadOnlyList<string> SavedSessionIds => OpenSessionIds ?? [];

    [JsonIgnore]
    public IReadOnlyList<string> SavedRepoPaths => SelectedRepos ?? (SelectedRepo is null ? [] : [SelectedRepo]);

    [JsonIgnore]
    public IReadOnlyList<NativePaneLayout> SavedPaneLayouts => PaneLayouts ?? [];

    [JsonIgnore]
    public string EffectiveScreenshotCaptureDirectory
    {
        get
        {
            var defaultDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CodexNative",
                "captures");
            if (string.IsNullOrWhiteSpace(ScreenshotCaptureDirectory)) return defaultDirectory;
            try
            {
                var expanded = Environment.ExpandEnvironmentVariables(ScreenshotCaptureDirectory);
                return Path.IsPathRooted(expanded) ? Path.GetFullPath(expanded) : defaultDirectory;
            }
            catch
            {
                return defaultDirectory;
            }
        }
    }

    [JsonIgnore]
    public TimeSpan ScreenshotRetention => TimeSpan.FromDays(
        ScreenshotRetentionDays <= 0 ? 3 : Math.Clamp(ScreenshotRetentionDays, 1, 90));

    [JsonIgnore]
    public long ScreenshotMaximumPixels =>
        (long)(ScreenshotMaximumMegapixels <= 0
            ? 32
            : Math.Clamp(ScreenshotMaximumMegapixels, 1, 100)) * 1_000_000;
}

public sealed record NativePaneLayout(
    string Id,
    double Width,
    double InspectorHeight,
    List<NativePaneTabLayout>? Tabs = null,
    string? ActiveTabKey = null,
    bool InspectorCollapsed = false,
    bool AdaptiveEnabled = false,
    string AdaptivePreference = "balanced",
    string? StyleId = null)
{
    [JsonIgnore]
    public IReadOnlyList<NativePaneTabLayout> SavedTabs => Tabs ?? [];
}

public sealed record NativePaneTabLayout(
    string Kind,
    string Key,
    string? SessionId,
    string WorkingDirectory,
    string Title,
    long LaunchedAt = 0,
    string? ProviderId = null);

public sealed class NativeSettingsStore
{
    private readonly string _path;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public NativeSettingsStore(string? path = null)
    {
        _path = path ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CodexNative",
            "settings.json");
    }

    public async Task<NativeSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await using var stream = File.OpenRead(_path);
            var settings = await JsonSerializer.DeserializeAsync<NativeSettings>(stream, cancellationToken: cancellationToken);
            return settings is not null
                && NativeLaunchBuilder.IsValidDistribution(settings.Distribution)
                && NativeLaunchBuilder.IsValidLinuxPath(settings.WorkingDirectory)
                && NativeLaunchBuilder.IsValidLinuxPath(settings.DashboardWorkingDirectory)
                    ? settings
                    : NativeSettings.Default;
        }
        catch (IOException)
        {
            return NativeSettings.Default;
        }
        catch (UnauthorizedAccessException)
        {
            return NativeSettings.Default;
        }
        catch (JsonException)
        {
            return NativeSettings.Default;
        }
    }

    public async Task SaveAsync(NativeSettings settings, CancellationToken cancellationToken = default)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            var directory = Path.GetDirectoryName(_path)
                ?? throw new InvalidOperationException("Settings path has no parent directory.");
            Directory.CreateDirectory(directory);

            var temporaryPath = $"{_path}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
            try
            {
                await using (var stream = new FileStream(
                    temporaryPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    bufferSize: 4096,
                    useAsync: true))
                {
                    await JsonSerializer.SerializeAsync(stream, settings, cancellationToken: cancellationToken);
                    await stream.FlushAsync(cancellationToken);
                }

                for (var attempt = 0; ; attempt++)
                {
                    try
                    {
                        File.Move(temporaryPath, _path, true);
                        break;
                    }
                    catch (Exception ex) when (
                        attempt < 5 && ex is IOException or UnauthorizedAccessException)
                    {
                        await Task.Delay(TimeSpan.FromMilliseconds(40 * (attempt + 1)), cancellationToken);
                    }
                }
            }
            finally
            {
                try { File.Delete(temporaryPath); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        finally
        {
            _writeLock.Release();
        }
    }
}
