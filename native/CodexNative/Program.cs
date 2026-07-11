using Avalonia;
using CodexNative.Core;

namespace CodexNative;

internal static class Program
{
    private static NativeInstallLock? _startupInstallLock;

    [STAThread]
    public static void Main(string[] args)
    {
        var startupHealthToken = NativeStartupHealthHandshake.ParseToken(args);
        if (!CanStartDuringNativeUpdate(args, startupHealthToken is not null)) return;
        var applicationArguments = NativeStartupHealthHandshake.RemoveArguments(args)
            .Where(argument => !argument.Equals(
                NativeInstallLock.AuthorizedRestartArgument,
                StringComparison.Ordinal))
            .ToArray();
        if (startupHealthToken is not null)
        {
            var platform = NativePlatformProfile.Current.Platform;
            var installDirectory = NativeInstallLayout.FindCurrentInstallDirectory(
                platform,
                AppContext.BaseDirectory);
            App.StartupHealthSignal = () =>
            {
                try
                {
                    NativeStartupHealthHandshake.SignalReady(installDirectory, startupHealthToken);
                }
                finally
                {
                    Interlocked.Exchange(ref _startupInstallLock, null)?.Dispose();
                }
            };
        }
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(applicationArguments);
    }

    internal static bool CanStartDuringNativeUpdate(
        IReadOnlyList<string> args,
        bool hasStartupHealthToken)
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
        var updateInProgress = NativeUpdateInstallationState.IsInProgress(installDirectory);
        if (!NativeInstallLock.CanStart(
                lockHeld,
                updateInProgress,
                hasStartupHealthToken,
                args)) return false;
        if (!lockHeld && !updateInProgress) return true;
        _startupInstallLock = NativeInstallLock.Acquire(installDirectory, TimeSpan.FromMinutes(2));
        return true;
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace();
}
