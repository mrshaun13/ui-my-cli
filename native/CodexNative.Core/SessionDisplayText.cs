using System.Text;

namespace CodexNative.Core;

public static class SessionDisplayText
{
    public const int MaximumTitleLength = 160;
    public const int MaximumPromptPreviewLength = 500;

    public static string Title(string? value, string fallback = "Untitled session") =>
        SingleLine(value, fallback, MaximumTitleLength);

    public static string PromptPreview(string? value) =>
        SingleLine(value, string.Empty, MaximumPromptPreviewLength);

    public static string CanonicalTitleOrDisplay(string? value)
    {
        if (!string.IsNullOrWhiteSpace(value)
            && value.EnumerateRunes().Count() <= MaximumTitleLength
            && !value.Any(char.IsControl)) return value;
        return Title(value);
    }

    private static string SingleLine(string? value, string fallback, int maximumLength)
    {
        var source = string.IsNullOrWhiteSpace(value) ? fallback : value;
        var controlSafe = string.Concat(source.Select(character => char.IsControl(character) ? ' ' : character));
        var normalized = string.Join(' ', controlSafe
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        var characters = normalized.EnumerateRunes().ToArray();
        if (characters.Length <= maximumLength) return normalized;
        return $"{string.Concat(characters.Take(maximumLength - 1).Select(character => character.ToString())).TrimEnd()}…";
    }
}
