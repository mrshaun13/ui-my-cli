namespace CodexNative.Core;

public static class CodexTerminalReadiness
{
    public static bool HasComposer(
        bool cursorVisible,
        int cursorRow,
        int terminalRows,
        IEnumerable<string> bottomLines)
    {
        if (!cursorVisible || cursorRow < Math.Max(0, terminalRows - 8)) return false;

        return bottomLines.Any(line =>
        {
            var text = line.TrimStart(' ', '•', '›', '>', '●', '○');
            return text.StartsWith("gpt-", StringComparison.OrdinalIgnoreCase)
                || text.StartsWith("codex-", StringComparison.OrdinalIgnoreCase)
                || StartsWithOpenAiReasoningModel(text);
        });
    }

    private static bool StartsWithOpenAiReasoningModel(string text) =>
        text.Length >= 2
        && (text[0] == 'o' || text[0] == 'O')
        && char.IsAsciiDigit(text[1]);
}
