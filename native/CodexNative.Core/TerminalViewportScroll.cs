namespace CodexNative.Core;

public static class TerminalViewportScroll
{
    private const int LinesPerWheelNotch = 3;

    public static int Next(int current, int maximum, double wheelDelta) =>
        Math.Clamp(
            current + (int)(-wheelDelta * LinesPerWheelNotch),
            0,
            Math.Max(0, maximum));
}
