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

    public GitHubReleaseClient(HttpClient? httpClient = null)
    {
        _ownsClient = httpClient is null;
        _http = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        if (!_http.DefaultRequestHeaders.UserAgent.Any())
            _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("CodexNative", "1.0"));
        _http.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
    }

    public async Task<NativeReleaseInfo?> GetLatestAsync(
        NativeVersion currentVersion,
        string runtimeIdentifier,
        CancellationToken cancellationToken = default)
    {
        ValidateRuntimeIdentifier(runtimeIdentifier);
        using var response = await _http.GetAsync(
            LatestReleaseApi,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();

        var metadata = await ReadBoundedAsync(
            response.Content,
            MaximumReleaseMetadataBytes,
            "GitHub release metadata",
            cancellationToken);
        using var json = JsonDocument.Parse(metadata, new JsonDocumentOptions { MaxDepth = 32 });
        var root = json.RootElement;
        if (root.TryGetProperty("draft", out var draft) && draft.GetBoolean()) return null;
        if (root.TryGetProperty("prerelease", out var prerelease) && prerelease.GetBoolean()) return null;

        var tag = RequiredString(root, "tag_name", 64);
        var version = NativeVersion.Parse(tag);
        if (version <= currentVersion) return null;

        var packageName = PackageAssetName(runtimeIdentifier);
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
        return new NativeReleaseInfo(version, tag, displayName, releasePage, package, checksum);
    }

    public static string PackageAssetName(string runtimeIdentifier)
    {
        ValidateRuntimeIdentifier(runtimeIdentifier);
        return $"CodexNative-{runtimeIdentifier}.zip";
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
