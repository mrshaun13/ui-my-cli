namespace CodexNative.Core;

public static class ScreenshotAttachmentPath
{
    public static string ToWslPath(string windowsPath)
    {
        if (string.IsNullOrWhiteSpace(windowsPath))
            throw new ArgumentException("Screenshot path is required.", nameof(windowsPath));

        var normalized = windowsPath.Replace('/', '\\');
        if (normalized.Length < 3
            || !char.IsAsciiLetter(normalized[0])
            || normalized[1] != ':'
            || normalized[2] != '\\')
        {
            throw new ArgumentException("Screenshot path must be an absolute Windows drive path.", nameof(windowsPath));
        }

        var drive = char.ToLowerInvariant(normalized[0]);
        var remainder = normalized[3..]
            .Replace('\\', '/')
            .TrimStart('/');
        return $"/mnt/{drive}/{remainder}";
    }

    public static string ComposerReference(string wslPath)
    {
        if (string.IsNullOrWhiteSpace(wslPath)
            || !wslPath.StartsWith("/", StringComparison.Ordinal)
            || wslPath.Any(char.IsControl)
            || wslPath.Contains('`'))
        {
            throw new ArgumentException("Screenshot WSL path is invalid.", nameof(wslPath));
        }

        return $"`{wslPath}` ";
    }
}
