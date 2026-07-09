namespace CodexNative;

internal static class NativeLog
{
    private const int MaximumMessageLength = 16_384;
    private static readonly object Gate = new();
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "CodexNative",
        "codex-native.log");

    public static string FilePath => LogPath;

    public static void Write(string message)
    {
        try
        {
            var safeMessage = Sanitize(message);
            lock (Gate)
            {
                var logDirectory = Path.GetDirectoryName(LogPath)!;
                Directory.CreateDirectory(logDirectory);
                if (!OperatingSystem.IsWindows())
                {
                    File.SetUnixFileMode(
                        logDirectory,
                        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
                }
                File.AppendAllText(
                    LogPath,
                    $"{DateTimeOffset.Now:O} {safeMessage}{Environment.NewLine}");
                if (!OperatingSystem.IsWindows())
                {
                    File.SetUnixFileMode(LogPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                }
            }
        }
        catch
        {
            // Diagnostics must never prevent the terminal from launching.
        }
    }

    private static string Sanitize(string message)
    {
        var normalized = string.Concat(message.Take(MaximumMessageLength).Select(character => character switch
        {
            '\r' => ' ',
            '\n' => ' ',
            '\t' => ' ',
            _ when char.IsControl(character) => ' ',
            _ => character,
        }));
        return message.Length > MaximumMessageLength ? $"{normalized} [truncated]" : normalized;
    }
}
