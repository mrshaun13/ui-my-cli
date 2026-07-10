namespace CodexNative.Core;

public static class SessionTitleDisplay
{
    public const int MaximumLength = 96;
    public const string Fallback = "Untitled session";

    public static string Compact(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return Fallback;

        var singleLine = string.Join(
            ' ',
            title.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (singleLine.Length <= MaximumLength) return singleLine;

        var contentLength = MaximumLength - 1;
        if (contentLength > 0 && char.IsHighSurrogate(singleLine[contentLength - 1]))
            contentLength--;
        return $"{singleLine[..contentLength].TrimEnd()}…";
    }
}
