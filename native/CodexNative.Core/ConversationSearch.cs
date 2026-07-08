namespace CodexNative.Core;

public static class ConversationSearch
{
    public const int MaximumQueryLength = 256;

    public static string Normalize(string? query)
    {
        var normalized = (query ?? string.Empty).Trim();
        return normalized.Length <= MaximumQueryLength
            ? normalized
            : normalized[..MaximumQueryLength];
    }

    public static bool Matches(string? query, string? userText, string? assistantText)
    {
        var normalized = Normalize(query);
        return normalized.Length == 0
            || Contains(userText, normalized)
            || Contains(assistantText, normalized);
    }

    private static bool Contains(string? value, string query) =>
        value?.Contains(query, StringComparison.OrdinalIgnoreCase) == true;
}
