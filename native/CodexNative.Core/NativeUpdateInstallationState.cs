using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;

namespace CodexNative.Core;

public static class NativeUpdateInstallationState
{
    private const string MarkerFileName = ".codex-native-update-in-progress";

    public static void MarkInProgress(string installDirectory)
    {
        var path = MarkerPath(installDirectory);
        using var process = Process.GetCurrentProcess();
        File.WriteAllLines(path,
        [
            process.Id.ToString(CultureInfo.InvariantCulture),
            process.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture),
        ]);
    }

    public static bool IsInProgress(string installDirectory)
    {
        var path = MarkerPath(installDirectory);
        if (!File.Exists(path)) return false;

        var lines = File.ReadAllLines(path);
        if (lines.Length is < 1 or > 2
            || !int.TryParse(lines[0], NumberStyles.None, CultureInfo.InvariantCulture, out var processId)
            || processId <= 0)
            return ClearStale(path);

        try
        {
            using var process = Process.GetProcessById(processId);
            if (process.HasExited) return ClearStale(path);
            if (lines.Length == 1) return true;
            if (!long.TryParse(lines[1], NumberStyles.None, CultureInfo.InvariantCulture, out var startedAt)
                || process.StartTime.ToUniversalTime().Ticks != startedAt)
                return ClearStale(path);
            return true;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return ClearStale(path);
        }
        catch (Win32Exception)
        {
            return true;
        }
    }

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

    private static bool ClearStale(string path)
    {
        try { File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return false;
    }
}
