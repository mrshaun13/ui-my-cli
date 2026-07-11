using Avalonia;
using CodexNative.Core;

namespace CodexNative;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        if (!CanStartDuringNativeUpdate(args)) return;
        var applicationArguments = args
            .Where(argument => !argument.Equals(
                NativeInstallLock.AuthorizedRestartArgument,
                StringComparison.Ordinal))
            .ToArray();
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(applicationArguments);
    }

    internal static bool CanStartDuringNativeUpdate(IReadOnlyList<string> args)
    {
        var platform = NativePlatformProfile.Current.Platform;
        if (platform is not (NativePlatform.Windows or NativePlatform.MacOS)) return true;
        string installDirectory;
        try
        {
            installDirectory = NativeInstallLayout.FindCurrentInstallDirectory(platform, AppContext.BaseDirectory);
        }
        catch (InvalidOperationException)
        {
            return true;
        }
        var lockHeld = NativeInstallLock.IsHeld(installDirectory);
        if (!NativeInstallLock.CanStart(lockHeld, args)) return false;
        if (!lockHeld) return true;
        using var updateLock = NativeInstallLock.Acquire(installDirectory, TimeSpan.FromMinutes(2));
        return true;
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace();
}
