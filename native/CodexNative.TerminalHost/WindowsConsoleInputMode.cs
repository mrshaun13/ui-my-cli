using System.ComponentModel;
using System.Runtime.InteropServices;
using CodexNative.Core;

namespace CodexNative.TerminalHost;

/// <summary>
/// Temporarily puts the ConPTY child console into raw VT-input mode.
/// </summary>
internal sealed class WindowsConsoleInputMode : IDisposable
{
    private const int StandardInputHandle = -10;
    private static readonly nint InvalidHandle = new(-1);

    private readonly nint _handle;
    private readonly uint _originalMode;
    private bool _restore;

    private WindowsConsoleInputMode(nint handle, uint originalMode, bool restore)
    {
        _handle = handle;
        _originalMode = originalMode;
        _restore = restore;
    }

    public static WindowsConsoleInputMode Enter()
    {
        if (!OperatingSystem.IsWindows())
        {
            return new WindowsConsoleInputMode(0, 0, false);
        }

        var handle = GetStdHandle(StandardInputHandle);
        if (handle == 0 || handle == InvalidHandle)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to access the terminal input handle.");
        }
        if (!GetConsoleMode(handle, out var originalMode))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to read the terminal input mode.");
        }

        var bridgeMode = TerminalInputMode.ForInteractiveBridge(originalMode);
        if (bridgeMode != originalMode && !SetConsoleMode(handle, bridgeMode))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to enable immediate terminal input.");
        }

        return new WindowsConsoleInputMode(handle, originalMode, bridgeMode != originalMode);
    }

    public void Dispose()
    {
        if (!_restore) return;
        _restore = false;
        SetConsoleMode(_handle, _originalMode);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nint GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetConsoleMode(nint consoleHandle, out uint mode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetConsoleMode(nint consoleHandle, uint mode);
}
