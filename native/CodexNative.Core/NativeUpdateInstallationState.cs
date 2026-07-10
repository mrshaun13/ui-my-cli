namespace CodexNative.Core;

public static class NativeUpdateInstallationState
{
    private const string MarkerFileName = ".codex-native-update-in-progress";

    public static void MarkInProgress(string installDirectory)
    {
        var path = MarkerPath(installDirectory);
        File.WriteAllText(
            path,
            Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    public static bool IsInProgress(string installDirectory) =>
        File.Exists(MarkerPath(installDirectory));

    public static void Clear(string installDirectory)
    {
        var path = MarkerPath(installDirectory);
        try { File.Delete(path); }
        catch (FileNotFoundException) { }
        catch (DirectoryNotFoundException) { }
    }

    private static string MarkerPath(string installDirectory)
    {
        if (!Path.IsPathFullyQualified(installDirectory) || installDirectory.Any(char.IsControl))
            throw new ArgumentException("Install directory must be absolute.", nameof(installDirectory));
        return Path.Combine(Path.GetFullPath(installDirectory), MarkerFileName);
    }
}
