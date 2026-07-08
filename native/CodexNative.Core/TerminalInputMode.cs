namespace CodexNative.Core;

/// <summary>
/// Computes the Windows console input flags required by the native terminal
/// bridge. The bridge must receive each key immediately as VT input; Windows'
/// default line editor would otherwise echo and buffer text locally.
/// </summary>
public static class TerminalInputMode
{
    public const uint EnableProcessedInput = 0x0001;
    public const uint EnableLineInput = 0x0002;
    public const uint EnableEchoInput = 0x0004;
    public const uint EnableInsertMode = 0x0020;
    public const uint EnableQuickEditMode = 0x0040;
    public const uint EnableExtendedFlags = 0x0080;
    public const uint EnableVirtualTerminalInput = 0x0200;

    public static uint ForInteractiveBridge(uint currentMode) =>
        (currentMode & ~(
            EnableProcessedInput
            | EnableLineInput
            | EnableEchoInput
            | EnableInsertMode
            | EnableQuickEditMode))
        | EnableExtendedFlags
        | EnableVirtualTerminalInput;
}
