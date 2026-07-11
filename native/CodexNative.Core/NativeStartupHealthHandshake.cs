using System.Globalization;

namespace CodexNative.Core;

public static class NativeStartupHealthHandshake
{
    public const string Argument = "--update-startup-health";

    public static string CreateToken() => Guid.NewGuid().ToString("N");

    public static string? ParseToken(IReadOnlyList<string> arguments)
    {
        var indexes = arguments
            .Select((argument, index) => (argument, index))
            .Where(item => item.argument.Equals(Argument, StringComparison.Ordinal))
            .Select(item => item.index)
            .ToArray();
        if (indexes.Length == 0) return null;
        if (indexes.Length != 1 || indexes[0] + 1 >= arguments.Count)
            throw new ArgumentException("Native startup health arguments are invalid.", nameof(arguments));
        return ValidateToken(arguments[indexes[0] + 1]);
    }

    public static IReadOnlyList<string> RemoveArguments(IReadOnlyList<string> arguments)
    {
        var result = new List<string>(arguments.Count);
        for (var index = 0; index < arguments.Count; index++)
        {
            if (!arguments[index].Equals(Argument, StringComparison.Ordinal))
            {
                result.Add(arguments[index]);
                continue;
            }
            if (++index >= arguments.Count)
                throw new ArgumentException("Native startup health arguments are invalid.", nameof(arguments));
            ValidateToken(arguments[index]);
        }
        return result;
    }

    public static void SignalReady(string installDirectory, string token)
    {
        var path = ReadyPath(installDirectory, token);
        File.WriteAllText(path, Environment.ProcessId.ToString(CultureInfo.InvariantCulture));
    }

    public static bool IsReady(string installDirectory, string token, int expectedProcessId)
    {
        if (expectedProcessId <= 0) return false;
        try
        {
            return int.TryParse(
                    File.ReadAllText(ReadyPath(installDirectory, token)),
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out var processId)
                && processId == expectedProcessId;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    public static void Clear(string installDirectory, string token)
    {
        try { File.Delete(ReadyPath(installDirectory, token)); }
        catch (FileNotFoundException) { }
        catch (DirectoryNotFoundException) { }
    }

    private static string ReadyPath(string installDirectory, string token)
    {
        token = ValidateToken(token);
        var lockPath = NativeInstallLock.LockPath(installDirectory);
        var installName = Path.GetFileName(Path.TrimEndingDirectorySeparator(
            Path.GetFullPath(installDirectory)));
        return Path.Combine(
            Path.GetDirectoryName(lockPath)!,
            $".{installName}.startup-ready-{token}");
    }

    private static string ValidateToken(string token) =>
        Guid.TryParseExact(token, "N", out var parsed)
            ? parsed.ToString("N")
            : throw new ArgumentException("Native startup health token is invalid.", nameof(token));
}
