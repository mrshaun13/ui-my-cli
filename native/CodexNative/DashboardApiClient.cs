using System.Net.Http.Json;
using System.Text.Json;
using CodexNative.Core;

namespace CodexNative;

public sealed class DashboardApiClient : IDisposable
{
    public const int RequiredApiVersion = DashboardApiCompatibility.RequiredVersion;
    private static readonly string[] RequiredUsageWindows = ["1d", "2d", "7d", "14d", "30d", "all"];
    private static readonly Uri SharedService = new("http://127.0.0.1:7575/api/");
    private readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(90),
    };
    private Uri _service = SharedService;
    private string _providerId = "codex";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public int ConnectedPort => _service.Port;
    public string ProviderId => _providerId;
    public Uri StatusWebSocketUri => new(
        $"ws://127.0.0.1:{_service.Port}/ws/{Uri.EscapeDataString(_providerId)}/status");

    public Uri TerminalWebSocketUri(
        string sessionId,
        int columns = 120,
        int rows = 36,
        bool adaptive = false,
        string? providerId = null) =>
        new($"ws://127.0.0.1:{_service.Port}/ws/{ProviderPath(providerId)}/terminal/{Uri.EscapeDataString(sessionId)}?cols={columns}&rows={rows}&adaptive={(adaptive ? 1 : 0)}");

    public void UseProvider(string providerId)
    {
        if (string.IsNullOrWhiteSpace(providerId))
            throw new ArgumentException("Provider ID is required.", nameof(providerId));
        _providerId = providerId.Trim();
    }

    public async Task<bool> TryUseExistingServiceAsync(CancellationToken cancellationToken = default)
    {
        if (await ProbeAsync(SharedService, TimeSpan.FromSeconds(10), cancellationToken))
        {
            _service = SharedService;
            return true;
        }
        foreach (var port in DashboardServicePorts.PrivateCandidates)
        {
            var candidate = PrivateService(port);
            if (!await ProbeAsync(candidate, TimeSpan.FromMilliseconds(400), cancellationToken)) continue;
            _service = candidate;
            return true;
        }
        return false;
    }

    public void UsePrivateService(int port)
    {
        if (!DashboardServicePorts.IsPrivateCandidate(port))
            throw new ArgumentOutOfRangeException(nameof(port));
        _service = PrivateService(port);
    }

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

    public Task<List<ProviderStatus>> GetProvidersAsync(CancellationToken cancellationToken = default) =>
        GetAsync<List<ProviderStatus>>(new Uri(_service, "providers"), "providers", cancellationToken);

    public Task<List<DashboardSession>> GetSessionsAsync(
        CancellationToken cancellationToken = default,
        string? providerId = null) =>
        GetProviderAsync<List<DashboardSession>>("sessions", cancellationToken, providerId);

    public async Task<HashSet<string>> GetActiveTerminalIdsAsync(
        CancellationToken cancellationToken = default,
        string? providerId = null)
    {
        var terminals = await GetProviderAsync<List<TerminalDescriptor>>("terminals", cancellationToken, providerId);
        return terminals
            .Where(terminal => !string.IsNullOrWhiteSpace(terminal.SessionId))
            .Select(terminal => terminal.SessionId)
            .ToHashSet(StringComparer.Ordinal);
    }

    public Task<List<DashboardSession>> GetArchivedSessionsAsync(
        CancellationToken cancellationToken = default,
        string? providerId = null) =>
        GetProviderAsync<List<DashboardSession>>("sessions/archived", cancellationToken, providerId);

    public Task<List<DashboardRepo>> GetReposAsync(CancellationToken cancellationToken = default) =>
        GetProviderAsync<List<DashboardRepo>>("repos", cancellationToken);

    public async Task<DashboardStats> GetStatsAsync(
        string statsMode = "combined",
        CancellationToken cancellationToken = default)
    {
        var stats = await GetProviderAsync<DashboardStats>(
            $"stats?statsMode={Uri.EscapeDataString(statsMode)}",
            cancellationToken);
        if (!_providerId.Equals("codex", StringComparison.OrdinalIgnoreCase)) return stats;

        // Credit rollups and every heatmap window are part of the Codex v2
        // contract. Other providers may expose a smaller analytics surface.
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
        GetProviderAsync<List<DashboardSession>>(
            $"sessions/search?q={Uri.EscapeDataString(query)}&archived={(includeArchived ? 1 : 0)}",
            cancellationToken);

    public async Task<string> CreateSessionAsync(
        string workingDirectory,
        bool adaptive = false,
        CancellationToken cancellationToken = default)
    {
        using var response = await _http.PostAsJsonAsync(
            ProviderUri("sessions/create"),
            new { workingDir = workingDirectory, adaptive },
            cancellationToken);
        response.EnsureSuccessStatusCode();
        using var body = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        return body.RootElement.GetProperty("tempKey").GetString()
            ?? throw new InvalidDataException("Dashboard did not return a temporary session key.");
    }

    public async Task<AdaptiveRouteResult> SubmitAdaptivePromptAsync(
        string sessionId,
        string text,
        string preference = "balanced",
        string? workingDirectory = null,
        CancellationToken cancellationToken = default)
    {
        using var response = await _http.PostAsJsonAsync(
            ProviderUri($"sessions/{Uri.EscapeDataString(sessionId)}/adaptive/submit", providerId: "codex"),
            new { text, preference, workingDir = workingDirectory },
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            string? message = null;
            try
            {
                using var body = await JsonDocument.ParseAsync(
                    await response.Content.ReadAsStreamAsync(cancellationToken),
                    cancellationToken: cancellationToken);
                message = body.RootElement.TryGetProperty("error", out var error)
                    ? error.GetString()
                    : null;
            }
            catch (JsonException) { }
            throw new InvalidOperationException(message ?? $"Adaptive submission failed ({(int)response.StatusCode}).");
        }
        return await response.Content.ReadFromJsonAsync<AdaptiveRouteResult>(JsonOptions, cancellationToken)
            ?? throw new InvalidDataException("Dashboard returned no Adaptive routing decision.");
    }

    public async Task KillTerminalAsync(
        string sessionId,
        CancellationToken cancellationToken = default,
        string? providerId = null)
    {
        using var response = await _http.PostAsync(
            ProviderUri($"sessions/{Uri.EscapeDataString(sessionId)}/kill-pty", providerId),
            null,
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public Task<SessionContextData> GetContextAsync(
        string sessionId,
        CancellationToken cancellationToken = default,
        string? providerId = null) =>
        GetProviderAsync<SessionContextData>($"sessions/{Uri.EscapeDataString(sessionId)}/context", cancellationToken, providerId);

    public Task<SessionConfigData> GetConfigAsync(
        string sessionId,
        CancellationToken cancellationToken = default,
        string? providerId = null) =>
        GetProviderAsync<SessionConfigData>($"sessions/{Uri.EscapeDataString(sessionId)}/config", cancellationToken, providerId);

    public Task<SessionPreviewData> GetPreviewAsync(
        string sessionId,
        CancellationToken cancellationToken = default,
        string? providerId = null) =>
        GetProviderAsync<SessionPreviewData>($"sessions/{Uri.EscapeDataString(sessionId)}/preview", cancellationToken, providerId);

    public Task<SessionConversationData> GetConversationAsync(
        string sessionId,
        int offset = 0,
        int limit = 50,
        CancellationToken cancellationToken = default,
        string? providerId = null) =>
        GetProviderAsync<SessionConversationData>(
            $"sessions/{Uri.EscapeDataString(sessionId)}/conversation?offset={Math.Max(0, offset)}&limit={Math.Max(0, limit)}",
            cancellationToken,
            providerId);

    public Task<List<SubagentData>> GetSubagentsAsync(
        string sessionId,
        CancellationToken cancellationToken = default,
        string? providerId = null) =>
        GetProviderAsync<List<SubagentData>>($"sessions/{Uri.EscapeDataString(sessionId)}/subagents", cancellationToken, providerId);

    public async Task RenameAsync(
        string sessionId,
        string title,
        CancellationToken cancellationToken = default,
        string? providerId = null)
    {
        using var response = await _http.PostAsJsonAsync(
            ProviderUri($"sessions/{Uri.EscapeDataString(sessionId)}/rename", providerId),
            new { title },
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task ArchiveAsync(
        string sessionId,
        CancellationToken cancellationToken = default,
        string? providerId = null)
    {
        using var response = await _http.DeleteAsync(
            ProviderUri($"sessions/{Uri.EscapeDataString(sessionId)}", providerId),
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task RestoreAsync(
        string sessionId,
        CancellationToken cancellationToken = default,
        string? providerId = null)
    {
        using var response = await _http.PostAsync(
            ProviderUri($"sessions/{Uri.EscapeDataString(sessionId)}/restore", providerId),
            null,
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private string ProviderPath(string? providerId = null) =>
        Uri.EscapeDataString(string.IsNullOrWhiteSpace(providerId) ? _providerId : providerId.Trim());

    private Uri ProviderUri(string path, string? providerId = null) =>
        new(_service, $"{ProviderPath(providerId)}/{path}");

    private static Uri PrivateService(int port) => new($"http://127.0.0.1:{port}/api/");

    private Task<T> GetProviderAsync<T>(
        string path,
        CancellationToken cancellationToken,
        string? providerId = null) =>
        GetAsync<T>(ProviderUri(path, providerId), path, cancellationToken);

    private async Task<T> GetAsync<T>(Uri uri, string description, CancellationToken cancellationToken)
    {
        using var response = await _http.GetAsync(uri, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        return await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken)
            ?? throw new InvalidDataException($"Dashboard returned no data for {description}.");
    }

    public void Dispose() => _http.Dispose();

    private sealed class TerminalDescriptor
    {
        public string SessionId { get; set; } = string.Empty;
    }
}
