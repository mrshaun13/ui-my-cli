using System.Net.Http.Json;
using System.Text.Json;
using CodexNative.Core;

namespace CodexNative;

public sealed class DashboardApiClient : IDisposable
{
    public const int RequiredApiVersion = DashboardApiCompatibility.RequiredVersion;
    private static readonly string[] RequiredUsageWindows = ["1d", "2d", "7d", "14d", "30d", "all"];
    private static readonly Uri SharedService = new("http://127.0.0.1:7575/api/");
    private static readonly Uri PrivateService = new("http://127.0.0.1:7577/api/");
    private readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(30),
    };
    private Uri _service = SharedService;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public int ConnectedPort => _service.Port;
    public Uri StatusWebSocketUri => new($"ws://127.0.0.1:{_service.Port}/ws/codex/status");

    public Uri TerminalWebSocketUri(string sessionId, int columns = 120, int rows = 36) =>
        new($"ws://127.0.0.1:{_service.Port}/ws/codex/terminal/{Uri.EscapeDataString(sessionId)}?cols={columns}&rows={rows}");

    public async Task<bool> TryUseExistingServiceAsync(CancellationToken cancellationToken = default)
    {
        if (await ProbeAsync(SharedService, TimeSpan.FromSeconds(10), cancellationToken))
        {
            _service = SharedService;
            return true;
        }
        if (await ProbeAsync(PrivateService, TimeSpan.FromSeconds(4), cancellationToken))
        {
            _service = PrivateService;
            return true;
        }
        return false;
    }

    public void UsePrivateService() => _service = PrivateService;

    public Task<bool> IsAvailableAsync(CancellationToken cancellationToken = default) =>
        ProbeAsync(_service, TimeSpan.FromSeconds(2), cancellationToken);

    private async Task<bool> ProbeAsync(
        Uri service,
        TimeSpan timeoutDuration,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(timeoutDuration);
        try
        {
            using var response = await _http.GetAsync(new Uri(service, "status"), timeout.Token);
            if (!response.IsSuccessStatusCode) return false;
            var status = await response.Content.ReadFromJsonAsync<DashboardStatus>(JsonOptions, timeout.Token);
            if (status is not { Ok: true }) return false;
            return DashboardApiCompatibility.IsCompatible(status.ApiVersion);
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return false;
        }
    }

    public Task<List<DashboardSession>> GetSessionsAsync(CancellationToken cancellationToken = default) =>
        GetCodexAsync<List<DashboardSession>>("sessions", cancellationToken);

    public Task<List<DashboardSession>> GetArchivedSessionsAsync(CancellationToken cancellationToken = default) =>
        GetCodexAsync<List<DashboardSession>>("sessions/archived", cancellationToken);

    public Task<List<DashboardRepo>> GetReposAsync(CancellationToken cancellationToken = default) =>
        GetCodexAsync<List<DashboardRepo>>("repos", cancellationToken);

    public async Task<DashboardStats> GetStatsAsync(
        string statsMode = "combined",
        CancellationToken cancellationToken = default)
    {
        var stats = await GetCodexAsync<DashboardStats>(
            $"stats?statsMode={Uri.EscapeDataString(statsMode)}",
            cancellationToken);
        var missingWindows = RequiredUsageWindows
            .Where(window => !stats.UsageRollups.ContainsKey(window)
                || !stats.TokensByHour.ContainsKey(window)
                || stats.TokenHeatmap.Count != 7
                || stats.TokenHeatmap.Any(row => row.Count != 24
                    || row.Any(cell => !cell.Windows.ContainsKey(window))))
            .ToList();
        if (missingWindows.Count > 0)
        {
            throw new InvalidDataException(
                $"Dashboard API v{RequiredApiVersion} returned an incomplete analytics payload. " +
                $"Missing windows: {string.Join(", ", missingWindows)}.");
        }
        return stats;
    }

    public async Task<DashboardStatus> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _http.GetAsync(new Uri(_service, "status"), cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<DashboardStatus>(JsonOptions, cancellationToken)
            ?? throw new InvalidDataException("Dashboard returned no status data.");
    }

    public Task<List<DashboardSession>> SearchSessionsAsync(
        string query,
        bool includeArchived,
        CancellationToken cancellationToken = default) =>
        GetCodexAsync<List<DashboardSession>>(
            $"sessions/search?q={Uri.EscapeDataString(query)}&archived={(includeArchived ? 1 : 0)}",
            cancellationToken);

    public async Task<string> CreateSessionAsync(string workingDirectory, CancellationToken cancellationToken = default)
    {
        using var response = await _http.PostAsJsonAsync(CodexUri("sessions/create"), new { workingDir = workingDirectory }, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var body = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        return body.RootElement.GetProperty("tempKey").GetString()
            ?? throw new InvalidDataException("Dashboard did not return a temporary session key.");
    }

    public async Task KillTerminalAsync(string sessionId, CancellationToken cancellationToken = default)
    {
        using var response = await _http.PostAsync(CodexUri($"sessions/{Uri.EscapeDataString(sessionId)}/kill-pty"), null, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public Task<SessionContextData> GetContextAsync(string sessionId, CancellationToken cancellationToken = default) =>
        GetCodexAsync<SessionContextData>($"sessions/{Uri.EscapeDataString(sessionId)}/context", cancellationToken);

    public Task<SessionConfigData> GetConfigAsync(string sessionId, CancellationToken cancellationToken = default) =>
        GetCodexAsync<SessionConfigData>($"sessions/{Uri.EscapeDataString(sessionId)}/config", cancellationToken);

    public Task<SessionPreviewData> GetPreviewAsync(string sessionId, CancellationToken cancellationToken = default) =>
        GetCodexAsync<SessionPreviewData>($"sessions/{Uri.EscapeDataString(sessionId)}/preview", cancellationToken);

    public Task<SessionConversationData> GetConversationAsync(
        string sessionId,
        int offset = 0,
        int limit = 50,
        CancellationToken cancellationToken = default) =>
        GetCodexAsync<SessionConversationData>(
            $"sessions/{Uri.EscapeDataString(sessionId)}/conversation?offset={Math.Max(0, offset)}&limit={Math.Max(0, limit)}",
            cancellationToken);

    public Task<List<SubagentData>> GetSubagentsAsync(string sessionId, CancellationToken cancellationToken = default) =>
        GetCodexAsync<List<SubagentData>>($"sessions/{Uri.EscapeDataString(sessionId)}/subagents", cancellationToken);

    public async Task RenameAsync(string sessionId, string title, CancellationToken cancellationToken = default)
    {
        using var response = await _http.PostAsJsonAsync(
            CodexUri($"sessions/{Uri.EscapeDataString(sessionId)}/rename"),
            new { title },
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task ArchiveAsync(string sessionId, CancellationToken cancellationToken = default)
    {
        using var response = await _http.DeleteAsync(
            CodexUri($"sessions/{Uri.EscapeDataString(sessionId)}"),
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task RestoreAsync(string sessionId, CancellationToken cancellationToken = default)
    {
        using var response = await _http.PostAsync(
            CodexUri($"sessions/{Uri.EscapeDataString(sessionId)}/restore"),
            null,
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private Uri CodexUri(string path) => new(_service, $"codex/{path}");

    private async Task<T> GetCodexAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var response = await _http.GetAsync(CodexUri(path), cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        return await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken)
            ?? throw new InvalidDataException($"Dashboard returned no data for {path}.");
    }

    public void Dispose() => _http.Dispose();
}
