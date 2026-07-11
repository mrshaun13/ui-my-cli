using System.Text.Json;

namespace CodexNative.Core;

public sealed record NativeUpdateResult(
    bool Succeeded,
    string Version,
    string Message,
    DateTimeOffset RecordedAt);

public static class NativeUpdateResultStore
{
    private const int MaximumResultBytes = 32 * 1024;
    private const int MaximumMessageLength = 2048;

    public static void Write(string localApplicationData, NativeUpdateResult result)
    {
        var path = ResultPath(localApplicationData);
        var directory = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);
        var safe = result with
        {
            Version = Truncate(result.Version, 64),
            Message = Truncate(result.Message, MaximumMessageLength),
        };
        var temporary = $"{path}.{Environment.ProcessId}.tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(safe));
        File.Move(temporary, path, overwrite: true);
    }

    public static NativeUpdateResult? Take(string localApplicationData)
    {
        var path = ResultPath(localApplicationData);
        if (!File.Exists(path)) return null;
        try
        {
            var info = new FileInfo(path);
            if (info.Length is <= 0 or > MaximumResultBytes) return null;
            return JsonSerializer.Deserialize<NativeUpdateResult>(File.ReadAllText(path));
        }
        catch (JsonException)
        {
            return null;
        }
        finally
        {
            try { File.Delete(path); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static string ResultPath(string localApplicationData)
    {
        if (!Path.IsPathFullyQualified(localApplicationData) || localApplicationData.Any(char.IsControl))
            throw new ArgumentException("Local application data path must be absolute.", nameof(localApplicationData));
        return Path.Combine(localApplicationData, "CodexNative", "update-result.json");
    }

    private static string Truncate(string value, int maximumLength) =>
        value.Length <= maximumLength ? value : value[..maximumLength];
}
