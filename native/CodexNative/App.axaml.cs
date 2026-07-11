using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Platform;

namespace CodexNative;

public sealed partial class App : Application
{
    private static Action? _startupHealthSignal;
    internal static Action? StartupHealthSignal
    {
        set => _startupHealthSignal = value;
    }
    private TrayIcon? _menuBarIcon;

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var window = new MainWindow();
            desktop.MainWindow = window;
            if (OperatingSystem.IsMacOS()) ConfigureMacMenuBar(window);
        }

        base.OnFrameworkInitializationCompleted();
        Interlocked.Exchange(ref _startupHealthSignal, null)?.Invoke();
    }

    private void ConfigureMacMenuBar(MainWindow window)
    {
        var menu = new NativeMenu();
        var open = new NativeMenuItem("Open Codex Native");
        open.Click += (_, _) => window.ShowFromMenuBar();
        var start = new NativeMenuItem("Start or reconnect service");
        start.Click += async (_, _) => await window.StartServiceFromMenuBarAsync();
        var stop = new NativeMenuItem("Stop managed service");
        stop.Click += async (_, _) => await window.StopOwnedServiceFromMenuBarAsync();
        var quit = new NativeMenuItem("Quit Codex Native");
        quit.Click += async (_, _) => await window.QuitFromMenuBarAsync();
        menu.Items.Add(open);
        menu.Items.Add(start);
        menu.Items.Add(stop);
        menu.Items.Add(new NativeMenuItemSeparator());
        menu.Items.Add(quit);

        _menuBarIcon = new TrayIcon
        {
            Icon = new WindowIcon(AssetLoader.Open(new Uri("avares://CodexNative/Assets/codex-native-icon.png"))),
            ToolTipText = "Codex Native · local dashboard service",
            Menu = menu,
            IsVisible = true,
        };
        TrayIcon.SetIcons(this, new TrayIcons { _menuBarIcon });
    }
}
