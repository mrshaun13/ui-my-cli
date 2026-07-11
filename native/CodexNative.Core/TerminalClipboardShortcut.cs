namespace CodexNative.Core;

public enum TerminalClipboardAction
{
    None,
    Paste,
    CopySelection,
    CopyAll,
}

public static class TerminalClipboardShortcut
{
    public static TerminalClipboardAction Resolve(
        NativePlatform platform,
        string key,
        bool control,
        bool meta,
        bool shift,
        bool alt)
    {
        if (alt) return TerminalClipboardAction.None;
        if (shift && key.Equals("Insert", StringComparison.OrdinalIgnoreCase) && !control && !meta)
            return TerminalClipboardAction.Paste;
        if (control && key.Equals("Insert", StringComparison.OrdinalIgnoreCase) && !shift && !meta)
            return TerminalClipboardAction.CopySelection;

        if (platform == NativePlatform.MacOS)
        {
            if (!meta || control || shift) return TerminalClipboardAction.None;
            if (key.Equals("V", StringComparison.OrdinalIgnoreCase)) return TerminalClipboardAction.Paste;
            if (key.Equals("C", StringComparison.OrdinalIgnoreCase)) return TerminalClipboardAction.CopySelection;
            if (key.Equals("A", StringComparison.OrdinalIgnoreCase)) return TerminalClipboardAction.CopyAll;
            return TerminalClipboardAction.None;
        }

        if (!control || meta) return TerminalClipboardAction.None;
        if (key.Equals("V", StringComparison.OrdinalIgnoreCase)) return TerminalClipboardAction.Paste;
        if (!shift) return TerminalClipboardAction.None;
        if (key.Equals("C", StringComparison.OrdinalIgnoreCase)) return TerminalClipboardAction.CopySelection;
        if (key.Equals("A", StringComparison.OrdinalIgnoreCase)) return TerminalClipboardAction.CopyAll;
        return TerminalClipboardAction.None;
    }
}
