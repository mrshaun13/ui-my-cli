using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace CodexNative.Core;

public sealed record PreparedNativeUpdate(
    NativeReleaseInfo Release,
    string StagingDirectory,
    string PayloadDirectory,
    string InstallerExecutable);

public sealed class NativeUpdatePackage : IDisposable
{
    private const long MaximumChecksumBytes = 4096;
    private const long MaximumExpandedBytes = 900L * 1024 * 1024;
    private readonly HttpClient _http;
    private readonly bool _ownsClient;

    public NativeUpdatePackage(HttpClient? httpClient = null)
    {
        _ownsClient = httpClient is null;
        _http = httpClient ?? new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
    }

    public async Task<PreparedNativeUpdate> PrepareAsync(
        NativeReleaseInfo release,
        NativePlatformProfile platform,
        string updatesDirectory,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!Path.IsPathFullyQualified(updatesDirectory) || updatesDirectory.Any(char.IsControl))
            throw new ArgumentException("Update staging path must be absolute.", nameof(updatesDirectory));
        var expectedPackageName = GitHubReleaseClient.PackageAssetName(platform.ReleaseRuntimeIdentifier);
        if (release.Package.Name != expectedPackageName
            || release.Checksum.Name != $"{expectedPackageName}.sha256")
            throw new InvalidDataException("Release assets do not match the current operating system and architecture.");
        Directory.CreateDirectory(updatesDirectory);
        var staging = Path.Combine(
            updatesDirectory,
            $"{release.Version}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(staging);

        try
        {
            var archivePath = Path.Combine(staging, release.Package.Name);
            var checksumPath = Path.Combine(staging, release.Checksum.Name);
            await DownloadAsync(
                release.Package,
                archivePath,
                GitHubReleaseClient.MaximumPackageBytes,
                progress,
                cancellationToken);
            await DownloadAsync(
                release.Checksum,
                checksumPath,
                MaximumChecksumBytes,
                null,
                cancellationToken);
            await VerifyChecksumAsync(
                archivePath,
                checksumPath,
                release.Package.Name,
                cancellationToken);

            var extracted = Path.Combine(staging, "payload");
            Directory.CreateDirectory(extracted);
            ExtractVerifiedArchive(archivePath, extracted);
            var payload = ValidatePayload(extracted, platform);
            var installer = platform.Platform == NativePlatform.Windows
                ? Path.Combine(payload, "CodexNative.Updater.exe")
                : Path.Combine(payload, "CodexNative.app", "Contents", "MacOS", "CodexNative.Updater");
            if (!File.Exists(installer))
                throw new InvalidDataException("The update package does not contain its installer helper.");
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(installer, ExecutableMode);
            return new PreparedNativeUpdate(release, staging, payload, installer);
        }
        catch
        {
            TryDeleteDirectory(staging);
            throw;
        }
    }

    private async Task DownloadAsync(
        NativeReleaseAsset asset,
        string destination,
        long maximumBytes,
        IProgress<double>? progress,
        CancellationToken cancellationToken)
    {
        if (!GitHubReleaseClient.IsTrustedDownloadUri(asset.DownloadUri))
            throw new InvalidDataException("Refusing an untrusted update download URL.");
        using var response = await _http.GetAsync(
            asset.DownloadUri,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        response.EnsureSuccessStatusCode();
        if (response.RequestMessage?.RequestUri is not { } finalUri
            || !GitHubReleaseClient.IsTrustedDownloadUri(finalUri))
            throw new InvalidDataException("Update download redirected to an untrusted URL.");
        var declaredLength = response.Content.Headers.ContentLength;
        if (declaredLength is > 0 && (declaredLength > maximumBytes || declaredLength != asset.Size))
            throw new InvalidDataException($"Downloaded size metadata for {asset.Name} is invalid.");

        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var target = new FileStream(
            destination,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            81920,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var buffer = new byte[81920];
        long total = 0;
        while (true)
        {
            var count = await source.ReadAsync(buffer, cancellationToken);
            if (count == 0) break;
            total += count;
            if (total > maximumBytes || total > asset.Size)
                throw new InvalidDataException($"Downloaded {asset.Name} exceeds its declared size.");
            await target.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
            progress?.Report(Math.Clamp((double)total / asset.Size, 0, 1));
        }
        if (total != asset.Size)
            throw new InvalidDataException($"Downloaded {asset.Name} size does not match the release metadata.");
        await target.FlushAsync(cancellationToken);
    }

    public static async Task VerifyChecksumAsync(
        string archivePath,
        string checksumPath,
        string expectedFileName,
        CancellationToken cancellationToken = default)
    {
        var checksumText = (await File.ReadAllTextAsync(checksumPath, cancellationToken)).Trim();
        var fields = checksumText.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (fields.Length != 2
            || fields[0].Length != 64
            || !fields[0].All(Uri.IsHexDigit)
            || fields[1].TrimStart('*') != expectedFileName)
            throw new InvalidDataException("Update checksum manifest is malformed or names another artifact.");

        await using var archive = File.OpenRead(archivePath);
        var actual = Convert.ToHexString(await SHA256.HashDataAsync(archive, cancellationToken));
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(actual),
                Encoding.ASCII.GetBytes(fields[0].ToUpperInvariant())))
            throw new InvalidDataException("Update package checksum verification failed.");
    }

    public static void ExtractVerifiedArchive(string archivePath, string destinationDirectory)
    {
        var root = Path.GetFullPath(destinationDirectory)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var comparison = OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;
        long expanded = 0;
        using var archive = ZipFile.OpenRead(archivePath);
        foreach (var entry in archive.Entries)
        {
            var normalizedName = entry.FullName.Replace('\\', '/');
            if (normalizedName.StartsWith('/')
                || normalizedName.Split('/').Any(segment => segment is ".." or ".")
                || normalizedName.Contains(':'))
                throw new InvalidDataException($"Unsafe path in update archive: {entry.FullName}");
            var unixType = (entry.ExternalAttributes >> 16) & 0xF000;
            if (unixType == 0xA000)
                throw new InvalidDataException($"Symbolic links are not allowed in update archives: {entry.FullName}");

            expanded = checked(expanded + entry.Length);
            if (expanded > MaximumExpandedBytes)
                throw new InvalidDataException("Update archive expands beyond the permitted size.");
            var destination = Path.GetFullPath(Path.Combine(
                root,
                normalizedName.Replace('/', Path.DirectorySeparatorChar)));
            if (!destination.StartsWith(root, comparison))
                throw new InvalidDataException($"Unsafe path in update archive: {entry.FullName}");
            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(destination);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            using var input = entry.Open();
            using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            var buffer = new byte[81920];
            long written = 0;
            while (true)
            {
                var count = input.Read(buffer, 0, buffer.Length);
                if (count == 0) break;
                written += count;
                if (written > entry.Length)
                    throw new InvalidDataException($"Archive entry expanded beyond its declared size: {entry.FullName}");
                output.Write(buffer, 0, count);
            }
            if (written != entry.Length)
                throw new InvalidDataException($"Archive entry size did not match its metadata: {entry.FullName}");
        }
    }

    private static string ValidatePayload(string extracted, NativePlatformProfile platform)
    {
        if (platform.Platform == NativePlatform.Windows)
        {
            RequireFiles(extracted,
                "CodexNative.exe",
                "CodexNative.TerminalHost.exe",
                "CodexNative.Updater.exe");
            return extracted;
        }

        var app = Path.Combine(extracted, "CodexNative.app");
        var executableDirectory = Path.Combine(app, "Contents", "MacOS");
        RequireFiles(executableDirectory,
            "CodexNative",
            "CodexNative.TerminalHost",
            "CodexNative.Updater");
        RequireFiles(Path.Combine(app, "Contents"), "Info.plist");
        if (!OperatingSystem.IsWindows())
        {
            foreach (var name in new[] { "CodexNative", "CodexNative.TerminalHost", "CodexNative.Updater" })
                File.SetUnixFileMode(Path.Combine(executableDirectory, name), ExecutableMode);
        }
        return extracted;
    }

    private static readonly UnixFileMode ExecutableMode =
        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
        | UnixFileMode.GroupRead | UnixFileMode.GroupExecute
        | UnixFileMode.OtherRead | UnixFileMode.OtherExecute;

    private static void RequireFiles(string directory, params string[] names)
    {
        foreach (var name in names)
        {
            if (!File.Exists(Path.Combine(directory, name)))
                throw new InvalidDataException($"Update package is missing required file: {name}");
        }
    }

    private static void TryDeleteDirectory(string path)
    {
        try { Directory.Delete(path, recursive: true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    public void Dispose()
    {
        if (_ownsClient) _http.Dispose();
    }
}
