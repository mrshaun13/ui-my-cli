using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace CodexNative.Core;

public sealed record NativeReleaseAsset(string Name, Uri DownloadUri, long Size);

public sealed record NativeReleaseInfo(
    NativeVersion Version,
    string Tag,
    string DisplayName,
    Uri ReleasePage,
    NativeReleaseAsset Package,
    NativeReleaseAsset Checksum);

public sealed record GitHubReleaseQueryResult(
    NativeReleaseInfo? Release,
    string? EntityTag,
    bool NotModified);

public sealed class GitHubRateLimitException(DateTimeOffset retryAt)
    : HttpRequestException($"GitHub update checks are rate limited. Try again after {retryAt.ToLocalTime():g}.")
{
    public DateTimeOffset RetryAt { get; } = retryAt;
}

public sealed class GitHubReleaseClient : IDisposable
{
    public const long MaximumPackageBytes = 500L * 1024 * 1024;
    private const int MaximumReleaseMetadataBytes = 2 * 1024 * 1024;
    private static readonly Uri LatestReleaseApi =
        new("https://api.github.com/repos/mrshaun13/ui-my-cli/releases/latest");
    private static readonly HashSet<string> TrustedDownloadHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "github.com",
        "api.github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    };

    private readonly HttpClient _http;
    private readonly bool _ownsClient;

    public GitHubReleaseClient(HttpClient? httpClient = null, string? accessToken = null)
    {
        _ownsClient = httpClient is null;
        _http = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        if (!_http.DefaultRequestHeaders.UserAgent.Any())
            _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("CodexNative", "1.0"));
        _http.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        accessToken ??= Environment.GetEnvironmentVariable("CODEX_NATIVE_GITHUB_TOKEN");
        if (!string.IsNullOrWhiteSpace(accessToken))
        {
            if (accessToken.Length > 512 || accessToken.Any(char.IsControl))
                throw new ArgumentException("The explicitly supplied GitHub token is invalid.", nameof(accessToken));
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        }
    }

    public async Task<NativeReleaseInfo?> GetLatestAsync(
        NativeVersion currentVersion,
        string runtimeIdentifier,
        CancellationToken cancellationToken = default) =>
        (await QueryLatestAsync(currentVersion, runtimeIdentifier, null, cancellationToken)).Release;

    public async Task<GitHubReleaseQueryResult> QueryLatestAsync(
        NativeVersion currentVersion,
        string runtimeIdentifier,
        string? entityTag = null,
        CancellationToken cancellationToken = default)
    {
        ValidateRuntimeIdentifier(runtimeIdentifier);
        using var request = new HttpRequestMessage(HttpMethod.Get, LatestReleaseApi);
        if (!string.IsNullOrWhiteSpace(entityTag))
        {
            if (entityTag.Length > 256 || entityTag.Any(char.IsControl)
                || !EntityTagHeaderValue.TryParse(entityTag, out var parsedTag))
                throw new ArgumentException("Cached GitHub entity tag is invalid.", nameof(entityTag));
            request.Headers.IfNoneMatch.Add(parsedTag);
        }
        using var response = await _http.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotModified)
            return new GitHubReleaseQueryResult(null, entityTag, NotModified: true);
        if (response.StatusCode == HttpStatusCode.NotFound)
            return new GitHubReleaseQueryResult(null, response.Headers.ETag?.ToString(), NotModified: false);
        if (IsRateLimited(response))
            throw new GitHubRateLimitException(RateLimitReset(response));
        response.EnsureSuccessStatusCode();

        var metadata = await ReadBoundedAsync(
            response.Content,
            MaximumReleaseMetadataBytes,
            "GitHub release metadata",
            cancellationToken);
        using var json = JsonDocument.Parse(metadata, new JsonDocumentOptions { MaxDepth = 32 });
        var root = json.RootElement;
        if (root.TryGetProperty("draft", out var draft) && draft.GetBoolean())
            return new GitHubReleaseQueryResult(null, response.Headers.ETag?.ToString(), NotModified: false);
        if (root.TryGetProperty("prerelease", out var prerelease) && prerelease.GetBoolean())
            return new GitHubReleaseQueryResult(null, response.Headers.ETag?.ToString(), NotModified: false);

        var tag = RequiredString(root, "tag_name", 64);
        var version = NativeVersion.Parse(tag);
        if (version <= currentVersion)
            return new GitHubReleaseQueryResult(null, response.Headers.ETag?.ToString(), NotModified: false);

        var packageName = PackageAssetName(runtimeIdentifier, version);
        var checksumName = $"{packageName}.sha256";
        NativeReleaseAsset? package = null;
        NativeReleaseAsset? checksum = null;
        foreach (var assetJson in root.GetProperty("assets").EnumerateArray())
        {
            var name = RequiredString(assetJson, "name", 128);
            if (name != packageName && name != checksumName) continue;
            var url = new Uri(RequiredString(assetJson, "browser_download_url", 2048), UriKind.Absolute);
            if (!IsTrustedDownloadUri(url))
                throw new InvalidDataException($"Release asset '{name}' has an untrusted download URL.");
            var size = assetJson.GetProperty("size").GetInt64();
            if (size <= 0 || size > MaximumPackageBytes)
                throw new InvalidDataException($"Release asset '{name}' has an invalid size.");
            var asset = new NativeReleaseAsset(name, url, size);
            if (name == packageName) package = asset;
            else checksum = asset;
        }

        if (package is null || checksum is null)
            throw new InvalidDataException(
                $"Release {tag} does not contain both {packageName} and {checksumName}.");

        var releasePage = new Uri(RequiredString(root, "html_url", 2048), UriKind.Absolute);
        if (releasePage.Scheme != Uri.UriSchemeHttps
            || !releasePage.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Release page URL is not a trusted GitHub HTTPS URL.");

        var displayName = root.TryGetProperty("name", out var nameElement)
            ? Truncate(nameElement.GetString() ?? tag, 128)
            : tag;
        return new GitHubReleaseQueryResult(
            new NativeReleaseInfo(version, tag, displayName, releasePage, package, checksum),
            response.Headers.ETag?.ToString(),
            NotModified: false);
    }

    private static bool IsRateLimited(HttpResponseMessage response)
    {
        if (response.StatusCode == HttpStatusCode.TooManyRequests) return true;
        if (response.StatusCode != HttpStatusCode.Forbidden) return false;
        return response.Headers.Contains("X-RateLimit-Reset")
            || response.Headers.TryGetValues("X-RateLimit-Remaining", out var remaining)
            && remaining.Any(value => value == "0");
    }

    private static DateTimeOffset RateLimitReset(HttpResponseMessage response)
    {
        var now = DateTimeOffset.UtcNow;
        DateTimeOffset? candidate = null;
        if (response.Headers.TryGetValues("X-RateLimit-Reset", out var resetValues)
            && long.TryParse(resetValues.FirstOrDefault(), out var resetSeconds))
        {
            try { candidate = DateTimeOffset.FromUnixTimeSeconds(resetSeconds); }
            catch (ArgumentOutOfRangeException) { }
        }
        candidate ??= response.Headers.RetryAfter?.Date;
        if (candidate is null && response.Headers.RetryAfter?.Delta is { } retryDelay)
            candidate = now + retryDelay;
        candidate ??= now.AddMinutes(15);
        return candidate <= now
            ? now.AddMinutes(1)
            : candidate > now.AddDays(1)
                ? now.AddDays(1)
                : candidate.Value;
    }

    public static string PackageAssetName(string runtimeIdentifier, NativeVersion version)
    {
        ValidateRuntimeIdentifier(runtimeIdentifier);
        return $"CodexNative-v{version}-{runtimeIdentifier}.zip";
    }

    public static bool IsTrustedDownloadUri(Uri uri) =>
        uri.IsAbsoluteUri
        && uri.Scheme == Uri.UriSchemeHttps
        && uri.IsDefaultPort
        && TrustedDownloadHosts.Contains(uri.Host);

    private static void ValidateRuntimeIdentifier(string runtimeIdentifier)
    {
        if (runtimeIdentifier is not ("win-x64" or "osx-x64" or "osx-arm64"))
            throw new ArgumentException("Unsupported native update runtime.", nameof(runtimeIdentifier));
    }

    private static string RequiredString(JsonElement parent, string propertyName, int maximumLength)
    {
        var value = parent.GetProperty(propertyName).GetString();
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength || value.Any(char.IsControl))
            throw new InvalidDataException($"GitHub release field '{propertyName}' is invalid.");
        return value;
    }

    private static string Truncate(string value, int maximumLength) =>
        value.Length <= maximumLength ? value : value[..maximumLength];

    private static async Task<byte[]> ReadBoundedAsync(
        HttpContent content,
        int maximumBytes,
        string description,
        CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength is { } declaredLength && declaredLength > maximumBytes)
            throw new InvalidDataException($"{description} exceeds the permitted size.");
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        while (true)
        {
            var count = await stream.ReadAsync(chunk, cancellationToken);
            if (count == 0) break;
            if (buffer.Length + count > maximumBytes)
                throw new InvalidDataException($"{description} exceeds the permitted size.");
            buffer.Write(chunk, 0, count);
        }
        return buffer.ToArray();
    }

    public void Dispose()
    {
        if (_ownsClient) _http.Dispose();
    }
}
