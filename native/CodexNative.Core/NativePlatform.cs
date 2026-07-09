namespace CodexNative.Core;

public enum NativePlatform
{
    Windows,
    MacOS,
    Linux,
}
public sealed record NativePlatformProfile(
    NativePlatform Platform,
    string DisplayName,
    string LocalShellLabel,
    string TerminalHostFileName,
    string ReleaseRuntimeIdentifier)
{
    public bool UsesWsl => Platform == NativePlatform.Windows;
    public string SpeechHostFileName => Platform == NativePlatform.Windows
        ? "CodexNative.SpeechHost.exe"
        : "CodexNative.SpeechHost";

    public static NativePlatformProfile Current => For(
        OperatingSystem.IsWindows()
            ? NativePlatform.Windows
            : OperatingSystem.IsMacOS()
                ? NativePlatform.MacOS
                : NativePlatform.Linux,
        System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture);

    public static NativePlatformProfile For(
        NativePlatform platform,
        System.Runtime.InteropServices.Architecture architecture = System.Runtime.InteropServices.Architecture.X64)
    {
        var architectureName = architecture switch
        {
            System.Runtime.InteropServices.Architecture.Arm64 => "arm64",
            System.Runtime.InteropServices.Architecture.X64 => "x64",
            _ => throw new PlatformNotSupportedException($"Unsupported native architecture: {architecture}."),
        };

        return platform switch
        {
            NativePlatform.Windows when architecture == System.Runtime.InteropServices.Architecture.X64 =>
                new(platform, "Windows + WSL2", "Ubuntu shell", "CodexNative.TerminalHost.exe", "win-x64"),
            NativePlatform.Windows =>
                throw new PlatformNotSupportedException("The Windows native client currently supports x64 only."),
            NativePlatform.MacOS =>
                new(platform, "macOS", "macOS shell", "CodexNative.TerminalHost", $"osx-{architectureName}"),
            NativePlatform.Linux =>
                new(platform, "Linux", "Linux shell", "CodexNative.TerminalHost", $"linux-{architectureName}"),
            _ => throw new ArgumentOutOfRangeException(nameof(platform)),
        };
    }
}
