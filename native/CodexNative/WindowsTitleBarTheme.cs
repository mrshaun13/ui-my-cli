using System.Runtime.InteropServices;
using Avalonia.Media;

namespace CodexNative;

internal static class WindowsTitleBarTheme
{
    private const int UseImmersiveDarkMode = 20;
    private const int BorderColor = 34;
    private const int CaptionColor = 35;
    private const int TextColor = 36;

    public static void Apply(
        nint windowHandle,
        Color caption,
        Color text,
        Color border,
        bool darkMode)
    {
        if (!OperatingSystem.IsWindows() || windowHandle == 0) return;

        try
        {
            var dark = darkMode ? 1 : 0;
            _ = DwmSetWindowAttribute(windowHandle, UseImmersiveDarkMode, ref dark, sizeof(int));
            if (Environment.OSVersion.Version.Build < 22_000) return;

            var captionRef = ToColorRef(caption);
            var textRef = ToColorRef(text);
            var borderRef = ToColorRef(border);
            _ = DwmSetWindowAttribute(windowHandle, CaptionColor, ref captionRef, sizeof(uint));
            _ = DwmSetWindowAttribute(windowHandle, TextColor, ref textRef, sizeof(uint));
            _ = DwmSetWindowAttribute(windowHandle, BorderColor, ref borderRef, sizeof(uint));
        }
        catch (DllNotFoundException)
        {
            // Non-Windows publish targets keep the system title bar unchanged.
        }
        catch (EntryPointNotFoundException)
        {
            // Older Windows builds keep the system title bar unchanged.
        }
    }

    private static uint ToColorRef(Color color) =>
        (uint)(color.R | color.G << 8 | color.B << 16);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        nint windowHandle,
        int attribute,
        ref int value,
        int valueSize);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        nint windowHandle,
        int attribute,
        ref uint value,
        int valueSize);
}
