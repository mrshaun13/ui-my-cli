namespace CodexNative.Core;

public static class SessionDisplayText
{
    public const int MaximumTitleLength = 160;
    public const int MaximumPromptPreviewLength = 500;

    public static string Title(string? value, string fallback = "Untitled session") =>
        SingleLine(value, fallback, MaximumTitleLength);

    public static string PromptPreview(string? value) =>
        SingleLine(value, string.Empty, MaximumPromptPreviewLength);

    private static string SingleLine(string? value, string fallback, int maximumLength)
    {
        var source = string.IsNullOrWhiteSpace(value) ? fallback : value;
        var normalized = string.Join(' ', source
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        if (normalized.Length <= maximumLength) return normalized;
        return $"{normalized[..(maximumLength - 1)].TrimEnd()}…";
    }
}
