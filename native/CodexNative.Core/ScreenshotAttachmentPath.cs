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

    public static string ComposerReference(string attachmentPath)
    {
        if (string.IsNullOrWhiteSpace(attachmentPath)
            || !attachmentPath.StartsWith("/", StringComparison.Ordinal)
            || attachmentPath.Any(char.IsControl)
            || attachmentPath.Contains('`'))
        {
            throw new ArgumentException("Screenshot attachment path is invalid.", nameof(attachmentPath));
        }

        return $"`{attachmentPath}` ";
    }
}
