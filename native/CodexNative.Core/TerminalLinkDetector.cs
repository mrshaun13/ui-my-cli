using System.Text.RegularExpressions;

namespace CodexNative.Core;

public readonly record struct TerminalLinkSpan(int Start, int Length, string Url);

public static partial class TerminalLinkDetector
{
    private static readonly char[] TrailingPunctuation = ['.', ',', ';', ':', '!', '?', ')', ']', '}'];

    public static IReadOnlyList<TerminalLinkSpan> FindHttpUrls(string? line)
    {
        if (string.IsNullOrEmpty(line)) return [];

        var links = new List<TerminalLinkSpan>();
        foreach (Match match in HttpUrl().Matches(line))
        {
            var candidate = match.Value.TrimEnd(TrailingPunctuation);
            if (candidate.Length == 0) continue;
            if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri)) continue;
            if (uri.Scheme is not ("http" or "https") || string.IsNullOrWhiteSpace(uri.Host)) continue;
            links.Add(new TerminalLinkSpan(match.Index, candidate.Length, uri.AbsoluteUri));
        }
        return links;
    }

    public static string? FindHttpUrlAtColumn(string? line, int column)
    {
        if (string.IsNullOrEmpty(line) || column < 0) return null;

        foreach (var link in FindHttpUrls(line))
        {
            if (column >= link.Start && column < link.Start + link.Length) return link.Url;
        }
        return null;
    }

    [GeneratedRegex("https?://[^\\s<>\\\"']+", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HttpUrl();
}
