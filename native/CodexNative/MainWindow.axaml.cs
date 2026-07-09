using Avalonia;
using Avalonia.Automation;
using Avalonia.Collections;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Interactivity;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;
using CodexNative.Core;
using Iciclecreek.Terminal;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace CodexNative;

public sealed partial class MainWindow : Window
{
    private const double MinimumPaneWidth = 460;
    private const double PaneSplitterWidth = 5;
    private const double InspectorMinimumHeight = 120;
    private const double InspectorMaximumHeight = 480;
    private const double InspectorCollapsedHeight = 44;
    private const int AdaptiveComposerRow = 1;
    private const int InspectorSplitterRow = 2;
    private const int InspectorRow = 3;
    private static readonly string[] BrowserDashboardUrls =
    [
        "http://127.0.0.1:7575",
        "http://127.0.0.1:7576",
    ];
    private static readonly HttpClient BrowserDashboardProbeClient = new()
    {
        Timeout = TimeSpan.FromMilliseconds(700),
    };
    private static readonly IBrush StartingBrush = Brush.Parse("#F59E0B");
    private static readonly IBrush RunningBrush = Brush.Parse("#22C55E");
    private static readonly IBrush ErrorBrush = Brush.Parse("#EF4444");

    private readonly NativeSettingsStore _settingsStore = new();
    private readonly DashboardApiClient _api = new();
    private readonly DashboardServiceManager _serviceManager = new();
    private readonly NativePlatformProfile _platform = NativePlatformProfile.Current;
    private readonly NativeUpdateService _updateService = new();
    private readonly Dictionary<string, SessionTabState> _openTabs = [];
    private readonly Dictionary<string, TabItem> _previewTabs = [];
    private readonly Dictionary<TabItem, TerminalPaneState> _previewPaneByTab = [];
    private readonly Dictionary<TabItem, DashboardSession> _previewSessionByTab = [];
    private readonly List<TerminalPaneState> _panes = [];
    private readonly List<Border> _paneSplitters = [];
    private readonly HashSet<TerminalPaneState> _paneRemovalsInProgress = [];
    private readonly DispatcherTimer _refreshTimer;
    private readonly DispatcherTimer _connectionPulseTimer;
    private readonly DispatcherTimer _sessionHoverAnimationTimer;
    private readonly DispatcherTimer _updateCheckTimer;
    private readonly TranslateTransform _sessionHoverTopTransform = new();
    private readonly TranslateTransform _sessionHoverBottomTransform = new();
    private Grid? _hoveredSessionRow;
    private DashboardStatusFeed? _statusFeed;
    private CancellationTokenSource? _searchCancellation;
    private CancellationTokenSource? _updateInstallCancellation;
    private Flyout? _newSessionFlyout;
    private NativeSettings _settings = NativeSettings.Default;
    private List<DashboardSession> _sessions = [];
    private List<DashboardSession> _archivedSessions = [];
    private List<DashboardRepo> _repos = [];
    private List<ProviderStatus> _providers = [];
    private DashboardStats? _stats;
    private DashboardStatus? _dashboardStatus;
    private RateLimitInfo? _rateLimits;
    private DashboardTheme _currentTheme = DashboardTheme.All[0];
    private Color _sessionDividerAccent = Color.Parse(DashboardTheme.All[0].Accent);
    private Color _sessionDividerSecondary = Color.Parse(DashboardTheme.All[0].Secondary);
    private List<DashboardSession>? _searchResults;
    private readonly HashSet<string> _hiddenTokenCategories = new(StringComparer.Ordinal);
    private bool _refreshing;
    private bool _initializingSelectors;
    private bool _initializingProviderSelector;
    private bool _initializingNavigation;
    private bool _initializingAnalytics;
    private bool _shutdownConfirmed;
    private bool _closePromptOpen;
    private bool _uiReady;
    private bool _workspaceReady;
    private bool _isDashboardConnected;
    private bool _serviceStopRequested;
    private bool _restoringPaneLayout;
    private bool _updatingPaneLayout;
    private bool _screenshotCaptureInProgress;
    private bool _checkingForUpdate;
    private bool _updateInProgress;
    private NativeReleaseInfo? _availableUpdate;
    private int _refreshTick;
    private TerminalPaneState _activePane = null!;
    private readonly DateTimeOffset _connectionPulseStartedAt = DateTimeOffset.UtcNow;
    private DateTimeOffset _sessionHoverAnimationStartedAt = DateTimeOffset.UtcNow;

    [DllImport("user32.dll")]
    private static extern uint GetClipboardSequenceNumber();

    public MainWindow()
    {
        InitializeComponent();
        InitializePaneWorkspace();
        ApplyProviderChrome();
        AutomationProperties.SetName(DashboardTab, "Dashboard overview");
        CompactSessionsList.ContainerPrepared += OnCompactSessionContainerPrepared;
        _uiReady = true;
        Opened += OnWindowOpened;
        Activated += (_, _) => ApplyWindowsTitleBarTheme(_currentTheme);
        Closing += OnWindowClosing;
        KeyDown += OnWindowKeyDown;
        DashboardScroll.SizeChanged += (_, args) =>
        {
            DashboardPanel.Width = Math.Max(0, args.NewSize.Width - 44);
            ApplyResponsiveDashboardLayout(args.NewSize.Width);
        };
        SizeChanged += (_, _) =>
            Dispatcher.UIThread.Post(() =>
            {
                ApplyResponsiveHeaderLayout(Bounds.Width);
                ConstrainMainContentHeight();
                UpdateTerminalTabContentHeights();
            }, DispatcherPriority.Loaded);
        PaneWorkspaceScroll.SizeChanged += (_, _) => UpdatePaneWorkspaceSize();
        SessionFiltersToggle.SizeChanged += (_, args) =>
        {
            var horizontalPadding = SessionFiltersToggle.Padding.Left + SessionFiltersToggle.Padding.Right;
            SessionFiltersHeaderGrid.Width = Math.Max(0, args.NewSize.Width - horizontalPadding);
        };
        SessionHoverTopBand.RenderTransform = _sessionHoverTopTransform;
        SessionHoverBottomBand.RenderTransform = _sessionHoverBottomTransform;
        SessionHoverOverlay.SizeChanged += (_, _) => PositionSessionHoverOverlay();
        _refreshTimer = new DispatcherTimer(TimeSpan.FromSeconds(15), DispatcherPriority.Background, OnRefreshTimerTick);
        _connectionPulseTimer = new DispatcherTimer(
            TimeSpan.FromMilliseconds(40),
            DispatcherPriority.Background,
            OnConnectionPulseTick);
        _sessionHoverAnimationTimer = new DispatcherTimer(
            TimeSpan.FromMilliseconds(33),
            DispatcherPriority.Render,
            OnSessionHoverAnimationTick);
        _updateCheckTimer = new DispatcherTimer(
            TimeSpan.FromHours(6),
            DispatcherPriority.Background,
            async (_, _) => await CheckForUpdateAsync(reportCurrent: false));
        UpdateButton.IsVisible = (_platform.Platform is NativePlatform.Windows or NativePlatform.MacOS)
            && _updateService.CanSelfUpdate(_platform);
        SetSessionFiltersExpanded(false);
        UpdateHeaderConnectionIndicator();
        _connectionPulseTimer.Start();
    }

    private void InitializePaneWorkspace()
    {
        var activeBorder = CreatePaneFocusBorder();
        PrimaryPaneRoot.Children.Insert(0, activeBorder);
        var primary = new TerminalPaneState(
            "pane-1", WorkspaceTabs, PrimaryPaneRoot, PrimaryPaneAddButton,
            removeButton: null, emptyState: null, activeBorder,
            MinimumPaneWidth, inspectorHeight: 160);
        _panes.Add(primary);
        _activePane = primary;
        AddPaneSessionLauncher(primary);
        RegisterPane(primary);
        RebuildPaneHost(equalize: true);
        SetActivePane(primary);
    }

    private Border CreatePaneFocusBorder() => new()
    {
        BorderBrush = ResourceBrush("AccentBrush"),
        BorderThickness = new Thickness(1),
        Opacity = 0,
        IsHitTestVisible = false,
        ZIndex = 11,
    };

    private void RegisterPane(TerminalPaneState pane)
    {
        var themeSelector = new ComboBox
        {
            Width = 142,
            Height = 28,
            Padding = new Thickness(8, 2),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 3, 36, 0),
            ItemsSource = DashboardTheme.All
                .Select(theme => new PaneThemeOption(theme.Id, theme.Label))
                .ToList(),
            ZIndex = 13,
        };
        pane.ThemeComboBox = themeSelector;
        pane.Root.Children.Add(themeSelector);
        ToolTip.SetTip(themeSelector, "Choose a theme for this terminal pane");
        AutomationProperties.SetName(themeSelector, "Terminal pane theme");
        themeSelector.SelectionChanged += async (_, _) =>
        {
            if (pane.UpdatingThemeSelector || themeSelector.SelectedItem is not PaneThemeOption option) return;
            pane.StyleId = option.Id;
            ApplyPaneTheme(pane);
            await SaveWorkspaceAsync();
        };
        SyncPaneThemeSelector(pane);
        pane.AddButton.Tag = pane;
        pane.AddButton.Click += OnAddPaneClicked;
        if (pane.RemoveButton is not null)
        {
            pane.RemoveButton.Tag = pane;
            pane.RemoveButton.Click += OnRemovePaneClicked;
        }
        pane.Root.AddHandler(
            InputElement.PointerPressedEvent,
            (_, _) => SetActivePane(pane),
            RoutingStrategies.Tunnel,
            handledEventsToo: true);
        pane.Tabs.SelectionChanged += OnWorkspaceTabChanged;
        pane.Tabs.SizeChanged += (_, args) =>
        {
            var contentHeight = TerminalTabContentHeight(args.NewSize.Height);
            foreach (var state in _openTabs.Values.Where(state => ReferenceEquals(state.Pane, pane)))
                state.TerminalViewport.Height = contentHeight;
        };
        ApplyPaneTheme(pane);
    }

    private void AddPaneSessionLauncher(TerminalPaneState pane)
    {
        var button = new Button
        {
            Content = "+",
            Width = 28,
            Height = 26,
            Padding = new Thickness(0),
            FontSize = 16,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
        };
        ToolTip.SetTip(button, $"Start a new agent or {_platform.LocalShellLabel} session in this terminal pane");
        AutomationProperties.SetName(button, "Start a new session in this terminal pane");
        var launcher = new TabItem
        {
            Header = button,
            Content = null,
            Padding = new Thickness(0),
        };
        launcher.Classes.Add("session-launcher");
        pane.SessionLauncherTab = launcher;
        pane.Tabs.Items.Add(launcher);
        button.Click += (_, args) =>
        {
            args.Handled = true;
            SetActivePane(pane);
            ShowNewSessionChooser(button, pane);
        };
    }

    private static void AddTabToPane(TerminalPaneState pane, TabItem tab)
    {
        var launcherIndex = pane.SessionLauncherTab is null
            ? -1
            : pane.Tabs.Items.IndexOf(pane.SessionLauncherTab);
        if (launcherIndex >= 0) pane.Tabs.Items.Insert(launcherIndex, tab);
        else pane.Tabs.Items.Add(tab);
    }

    private static IEnumerable<TabItem> PaneContentTabs(TerminalPaneState pane) =>
        pane.Tabs.Items.OfType<TabItem>()
            .Where(tab => !ReferenceEquals(tab, pane.SessionLauncherTab));

    private TerminalPaneState CreateSecondaryPane(string? id = null, double? width = null, double inspectorHeight = 160)
    {
        var tabs = new TabControl
        {
            Background = ResourceBrush("BaseBrush"),
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
        };
        var startNew = new Button { Content = $"Choose agent or {_platform.LocalShellLabel}", Padding = new Thickness(12, 6) };
        var emptyState = new Border
        {
            Background = ResourceBrush("BaseBrush"),
            BorderBrush = ResourceBrush("BorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(7),
            Padding = new Thickness(18),
            Margin = new Thickness(18),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new StackPanel
            {
                Spacing = 9,
                Width = 250,
                Children =
                {
                    new TextBlock
                    {
                        Text = "EMPTY TERMINAL",
                        Foreground = ResourceBrush("AccentBrush"),
                        FontWeight = FontWeight.Bold,
                        HorizontalAlignment = HorizontalAlignment.Center,
                    },
                    new TextBlock
                    {
                        Text = $"Start an agent or {_platform.LocalShellLabel} session in this pane.",
                        Foreground = ResourceBrush("SecondaryBrush"),
                        TextAlignment = TextAlignment.Center,
                        TextWrapping = TextWrapping.Wrap,
                    },
                    startNew,
                },
            },
        };
        var addButton = PaneEdgeButton("+", "Add terminal pane", HorizontalAlignment.Right);
        var removeButton = PaneEdgeButton("−", "Remove this terminal pane", HorizontalAlignment.Left);
        var activeBorder = CreatePaneFocusBorder();
        var root = new Grid
        {
            MinWidth = MinimumPaneWidth,
            Background = ResourceBrush("BaseBrush"),
            Children = { activeBorder, tabs, emptyState, removeButton, addButton },
        };
        activeBorder.ZIndex = 11;
        removeButton.ZIndex = 12;
        addButton.ZIndex = 12;
        emptyState.ZIndex = 2;
        var pane = new TerminalPaneState(
            id ?? $"pane-{Guid.NewGuid():N}", tabs, root, addButton, removeButton,
            emptyState, activeBorder, width ?? MinimumPaneWidth, inspectorHeight);
        AddPaneSessionLauncher(pane);
        startNew.Click += (_, _) =>
        {
            SetActivePane(pane);
            ShowNewSessionChooser(startNew, pane);
        };
        RegisterPane(pane);
        return pane;
    }

    private Button PaneEdgeButton(string content, string tooltip, HorizontalAlignment alignment)
    {
        var button = new Button
        {
            Content = content,
            Width = 28,
            Height = 42,
            Padding = new Thickness(0),
            FontSize = 20,
            Opacity = 0.55,
            HorizontalAlignment = alignment,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            Background = ResourceBrush("ElevatedBrush"),
            BorderBrush = ResourceBrush("BorderBrightBrush"),
        };
        ToolTip.SetTip(button, tooltip);
        button.PointerEntered += (_, _) => button.Opacity = 0.95;
        button.PointerExited += (_, _) => button.Opacity = 0.55;
        return button;
    }

    private void OnAddPaneClicked(object? sender, RoutedEventArgs e)
    {
        var pane = CreateSecondaryPane();
        _panes.Add(pane);
        RebuildPaneHost(equalize: true);
        SetActivePane(pane);
        UpdatePaneEmptyStates();
        _ = SaveWorkspaceAsync();
        Dispatcher.UIThread.Post(() =>
        {
            PaneWorkspaceScroll.Offset = new Vector(PaneWorkspaceScroll.Extent.Width, 0);
            if (pane.EmptyState is not null)
                ShowNewSessionChooser(pane.EmptyState, pane);
        }, DispatcherPriority.Loaded);
    }

    private async void OnRemovePaneClicked(object? sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: TerminalPaneState pane } removeButton
            || ReferenceEquals(pane, _panes[0])
            || !_paneRemovalsInProgress.Add(pane)) return;
        var paneLabel = PaneLabel(pane);
        removeButton.IsEnabled = false;
        try
        {
            if (!await ConfirmPaneRemovalAsync(pane)) return;

            foreach (var state in _openTabs.Values.Where(state => ReferenceEquals(state.Pane, pane)).ToList())
            {
                if (state.Kind == TerminalSessionKind.LocalShell) await StopAndRemoveTabAsync(state, selectFallback: false);
                else await DetachTabAsync(state, selectFallback: false);
            }
            foreach (var preview in _previewPaneByTab.Where(entry => ReferenceEquals(entry.Value, pane)).Select(entry => entry.Key).ToList())
                RemovePreviewTab(preview, selectFallback: false);

            _panes.Remove(pane);
            SetActivePane(_panes[Math.Max(0, _panes.Count - 1)]);
            RebuildPaneHost(equalize: true);
            UpdatePaneEmptyStates();
            await SaveWorkspaceAsync();
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Terminal pane removal failed: {ex}");
            SetStatus($"Could not remove {paneLabel}: {ex.Message}", ErrorBrush);
        }
        finally
        {
            _paneRemovalsInProgress.Remove(pane);
            if (_panes.Contains(pane)) removeButton.IsEnabled = true;
        }
    }

    private async Task<bool> ConfirmPaneRemovalAsync(TerminalPaneState pane)
    {
        var states = _openTabs.Values.Where(state => ReferenceEquals(state.Pane, pane)).ToList();
        var providerCount = states.Count(state => state.Kind == TerminalSessionKind.Codex);
        var localShellCount = states.Count(state => state.Kind == TerminalSessionKind.LocalShell);
        var previewCount = _previewPaneByTab.Count(entry => ReferenceEquals(entry.Value, pane));
        if (providerCount + localShellCount + previewCount == 0) return true;

        var dialog = new Window
        {
            Title = "Remove terminal pane",
            Width = 440,
            Height = 230,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Background = ResourceBrush("SurfaceBrush"),
        };
        var cancel = new Button { Content = "Cancel", Padding = new Thickness(14, 6) };
        var remove = new Button { Content = "Remove pane", Padding = new Thickness(14, 6), Foreground = ErrorBrush };
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 8,
            Children = { cancel, remove },
        };
        dialog.Content = new StackPanel
        {
            Margin = new Thickness(20),
            Spacing = 14,
            Children =
            {
                new TextBlock { Text = $"Remove {PaneLabel(pane)}?", FontSize = 18, FontWeight = FontWeight.Bold, Foreground = ResourceBrush("PrimaryBrush") },
                new TextBlock
                {
                    Text = $"{providerCount} agent tab{(providerCount == 1 ? "" : "s")} will detach, " +
                           $"{localShellCount} {_platform.LocalShellLabel} shell{(localShellCount == 1 ? "" : "s")} will stop, and " +
                           $"{previewCount} summary tab{(previewCount == 1 ? "" : "s")} will close.",
                    Foreground = ResourceBrush("SecondaryBrush"),
                    TextWrapping = TextWrapping.Wrap,
                },
                actions,
            },
        };
        cancel.Click += (_, _) => dialog.Close(false);
        remove.Click += (_, _) => dialog.Close(true);
        dialog.Opened += (_, _) => ApplyWindowsTitleBarTheme(dialog, _currentTheme);
        return await dialog.ShowDialog<bool>(this);
    }

    private void RebuildPaneHost(bool equalize)
    {
        if (_panes.Count == 0 || _updatingPaneLayout) return;
        _updatingPaneLayout = true;
        try
        {
            if (equalize) EqualizePaneWidths();
            PaneHost.Children.Clear();
            PaneHost.ColumnDefinitions.Clear();
            _paneSplitters.Clear();
            for (var index = 0; index < _panes.Count; index++)
            {
                var pane = _panes[index];
                PaneHost.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(pane.Width)) { MinWidth = MinimumPaneWidth });
                Grid.SetColumn(pane.Root, index * 2);
                PaneHost.Children.Add(pane.Root);
                pane.AddButton.IsVisible = index == _panes.Count - 1;
                if (pane.RemoveButton is not null) pane.RemoveButton.IsVisible = index > 0;
                AutomationProperties.SetName(pane.Root, PaneLabel(pane));
                AutomationProperties.SetName(pane.AddButton, $"Add terminal pane after {PaneLabel(pane)}");
                if (pane.RemoveButton is not null) AutomationProperties.SetName(pane.RemoveButton, $"Remove {PaneLabel(pane)}");

                if (index >= _panes.Count - 1) continue;
                PaneHost.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(PaneSplitterWidth)));
                var left = pane;
                var right = _panes[index + 1];
                var leftColumnIndex = index * 2;
                var splitterColumnIndex = leftColumnIndex + 1;
                var rightColumnIndex = leftColumnIndex + 2;
                var splitter = new Border
                {
                    Width = PaneSplitterWidth,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    VerticalAlignment = VerticalAlignment.Stretch,
                    Background = ResourceBrush("BorderBrush"),
                    Cursor = new Cursor(StandardCursorType.SizeWestEast),
                    ZIndex = 20,
                };
                var previewTransform = new TranslateTransform();
                splitter.RenderTransform = previewTransform;
                var horizontalDragActive = false;
                var horizontalDragStartX = 0d;
                var leftStartWidth = left.Width;
                var rightStartWidth = right.Width;
                var pendingLeftWidth = left.Width;
                var pendingRightWidth = right.Width;
                splitter.PointerEntered += (_, _) => splitter.Background = ResourceBrush("BorderBrightBrush");
                splitter.PointerExited += (_, _) =>
                {
                    if (!horizontalDragActive) splitter.Background = ResourceBrush("BorderBrush");
                };
                splitter.PointerPressed += (_, args) =>
                {
                    if (!args.GetCurrentPoint(splitter).Properties.IsLeftButtonPressed) return;
                    horizontalDragActive = true;
                    horizontalDragStartX = args.GetPosition(PaneHost).X;
                    leftStartWidth = PaneHost.ColumnDefinitions[leftColumnIndex].ActualWidth;
                    rightStartWidth = PaneHost.ColumnDefinitions[rightColumnIndex].ActualWidth;
                    pendingLeftWidth = leftStartWidth;
                    pendingRightWidth = rightStartWidth;
                    splitter.Background = ResourceBrush("AccentBrush");
                    args.Pointer.Capture(splitter);
                    args.Handled = true;
                };
                splitter.PointerMoved += (_, args) =>
                {
                    if (!horizontalDragActive) return;
                    var requestedChange = args.GetPosition(PaneHost).X - horizontalDragStartX;
                    var resized = TerminalPaneLayoutMath.ResizePair(
                        leftStartWidth,
                        rightStartWidth,
                        requestedChange,
                        MinimumPaneWidth);
                    pendingLeftWidth = resized.Left;
                    pendingRightWidth = resized.Right;
                    previewTransform.X = pendingLeftWidth - leftStartWidth;
                    args.Handled = true;
                };
                splitter.PointerReleased += (_, args) =>
                {
                    if (!horizontalDragActive) return;
                    horizontalDragActive = false;
                    args.Pointer.Capture(null);
                    previewTransform.X = 0;
                    left.Width = pendingLeftWidth;
                    right.Width = pendingRightWidth;
                    CompleteHorizontalPaneResize(left, right);
                    args.Handled = true;
                };
                splitter.PointerCaptureLost += (_, _) =>
                {
                    if (!horizontalDragActive) return;
                    horizontalDragActive = false;
                    previewTransform.X = 0;
                    splitter.Background = ResourceBrush("BorderBrush");
                };
                Grid.SetColumn(splitter, splitterColumnIndex);
                _paneSplitters.Add(splitter);
                PaneHost.Children.Add(splitter);
            }
            PaneHost.Width = TerminalPaneLayoutMath.TotalWidth(
                _panes.Select(pane => pane.Width),
                PaneSplitterWidth);
            PaneHost.MinWidth = PaneHost.Width;
            UpdatePaneEmptyStates();
            SetActivePane(_activePane);
        }
        finally
        {
            _updatingPaneLayout = false;
        }
    }

    private void EqualizePaneWidths()
    {
        var viewportWidth = Math.Max(
            MinimumPaneWidth,
            Math.Max(PaneWorkspaceScroll.Viewport.Width, PaneWorkspaceScroll.Bounds.Width));
        var width = TerminalPaneLayoutMath.EqualPaneWidth(
            viewportWidth, _panes.Count, MinimumPaneWidth, PaneSplitterWidth);
        foreach (var pane in _panes) pane.Width = width;
    }

    private void UpdatePaneWorkspaceSize()
    {
        if (_panes.Count == 0 || _updatingPaneLayout) return;
        FitPaneWidthsToViewport();
        RebuildPaneHost(equalize: false);
        UpdateTerminalTabContentHeights();
    }

    private void FitPaneWidthsToViewport()
    {
        var viewportWidth = Math.Max(
            MinimumPaneWidth,
            Math.Max(PaneWorkspaceScroll.Viewport.Width, PaneWorkspaceScroll.Bounds.Width));
        var fitted = TerminalPaneLayoutMath.FitPaneWidths(
            _panes.Select(pane => pane.Width),
            viewportWidth,
            MinimumPaneWidth,
            PaneSplitterWidth);
        for (var index = 0; index < _panes.Count; index++)
            _panes[index].Width = fitted[index];
    }

    private void UpdateTerminalTabContentHeights()
    {
        var contentHeight = TerminalTabContentHeight();
        foreach (var state in _openTabs.Values)
            state.TerminalViewport.Height = contentHeight;
    }

    private void CompleteHorizontalPaneResize(TerminalPaneState left, TerminalPaneState right)
    {
        left.Width = Math.Max(MinimumPaneWidth, left.Width);
        right.Width = Math.Max(MinimumPaneWidth, right.Width);
        RebuildPaneHost(equalize: false);
        _ = SaveWorkspaceAsync();
    }

    private void SetActivePane(TerminalPaneState pane)
    {
        if (!_panes.Contains(pane)) return;
        _activePane = pane;
        foreach (var candidate in _panes)
        {
            candidate.ActiveBorder.BorderBrush = ResourceBrush("AccentBrush");
            candidate.ActiveBorder.Opacity = ReferenceEquals(candidate, pane) ? 0.72 : 0;
        }
    }

    private string PaneLabel(TerminalPaneState pane) => $"Terminal {_panes.IndexOf(pane) + 1}";

    private static string NormalizeAdaptivePreference(string? value) => value switch
    {
        "speed" => "speed",
        "quality" => "quality",
        _ => "balanced",
    };

    private static string ProviderTabKey(string providerId, string sessionId) =>
        $"provider:{providerId}:{sessionId}";

    private static string PreviewTabKey(string providerId, string sessionId) =>
        $"preview:{providerId}:{sessionId}";

    private static string OpenTabRegistryKey(SessionTabState state) =>
        state.Kind == TerminalSessionKind.LocalShell
            ? state.Key
            : ProviderTabKey(state.ProviderId, state.Key);

    private string SessionProvider(DashboardSession session) =>
        string.IsNullOrWhiteSpace(session.Provider) ? _api.ProviderId : session.Provider;

    private static bool IsCodexSession(SessionTabState state) =>
        state.Kind == TerminalSessionKind.Codex
        && state.ProviderId.Equals("codex", StringComparison.OrdinalIgnoreCase);

    private static bool IsPendingCodexSession(SessionTabState state) =>
        IsCodexSession(state)
        && state.Key.StartsWith("pending-", StringComparison.Ordinal);

    private DashboardTheme EffectivePaneTheme(TerminalPaneState pane) =>
        string.IsNullOrWhiteSpace(pane.StyleId)
            ? _currentTheme
            : DashboardTheme.Find(pane.StyleId);

    private static string? NormalizePaneStyleId(string? value) =>
        DashboardTheme.All.Any(theme => theme.Id == value) ? value : null;

    private void SyncPaneThemeSelector(TerminalPaneState pane)
    {
        if (pane.ThemeComboBox is null) return;
        pane.UpdatingThemeSelector = true;
        try
        {
            var selectedStyleId = pane.StyleId ?? _currentTheme.Id;
            pane.ThemeComboBox.SelectedItem = pane.ThemeComboBox.ItemsSource?
                .OfType<PaneThemeOption>()
                .FirstOrDefault(option => option.Id == selectedStyleId)
                ?? pane.ThemeComboBox.ItemsSource?.OfType<PaneThemeOption>().FirstOrDefault();
        }
        finally
        {
            pane.UpdatingThemeSelector = false;
        }
    }

    private void ApplyPaneTheme(TerminalPaneState pane)
    {
        SyncPaneThemeSelector(pane);
        var theme = EffectivePaneTheme(pane);
        ApplyScopedScrollbarTheme(pane.Root, theme);
        var baseBrush = Brush.Parse(theme.Base);
        var elevated = Brush.Parse(theme.Elevated);
        var border = Brush.Parse(theme.Border);
        var borderBright = Brush.Parse(theme.BorderBright);
        var primary = Brush.Parse(theme.Primary);
        var secondary = Brush.Parse(theme.Secondary);
        var accent = Brush.Parse(theme.Accent);
        pane.Root.Background = baseBrush;
        pane.Tabs.Background = baseBrush;
        pane.ActiveBorder.BorderBrush = accent;
        pane.AddButton.Background = elevated;
        pane.AddButton.BorderBrush = borderBright;
        if (pane.RemoveButton is not null)
        {
            pane.RemoveButton.Background = elevated;
            pane.RemoveButton.BorderBrush = borderBright;
        }
        if (pane.ThemeComboBox is not null)
        {
            pane.ThemeComboBox.Background = elevated;
            pane.ThemeComboBox.BorderBrush = borderBright;
            pane.ThemeComboBox.Foreground = primary;
        }
        if (pane.EmptyState is not null)
        {
            pane.EmptyState.Background = baseBrush;
            pane.EmptyState.BorderBrush = border;
            if (pane.EmptyState.Child is StackPanel emptyContent)
            {
                if (emptyContent.Children.ElementAtOrDefault(0) is TextBlock heading)
                    heading.Foreground = accent;
                if (emptyContent.Children.ElementAtOrDefault(1) is TextBlock body)
                    body.Foreground = secondary;
            }
        }
        foreach (var tab in pane.Tabs.Items.OfType<TabItem>())
        {
            var selected = ReferenceEquals(tab, pane.Tabs.SelectedItem);
            tab.Background = selected ? Brush.Parse(theme.Hover) : elevated;
            tab.BorderBrush = selected ? accent : borderBright;
            if (tab.Header is TextBlock text)
            {
                text.Foreground = primary;
            }
            else if (tab.Header is Button launcher)
            {
                launcher.Foreground = accent;
                launcher.Background = Brushes.Transparent;
            }
        }
        foreach (var state in _openTabs.Values.Where(candidate => ReferenceEquals(candidate.Pane, pane)))
            ApplyThemeToSessionState(state, theme);
    }

    private void UpdateAdaptiveControls(SessionTabState state)
    {
        var codex = IsCodexSession(state);
        var enabled = codex && state.Pane.AdaptiveEnabled;
        var pending = IsPendingCodexSession(state);
        state.AdaptiveToggleButton.IsVisible = codex;
        state.AdaptiveToggleButton.IsChecked = enabled;
        state.AdaptiveToggleButton.Content = enabled ? "Adaptive on" : "Adaptive off";
        state.AdaptiveToggleButton.IsEnabled = codex && !state.Pane.AdaptiveChanging;
        state.AdaptiveComposer.IsVisible = enabled;
        state.AdaptivePromptBox.IsEnabled = !state.AdaptiveSubmitting && !state.Pane.AdaptiveChanging;
        state.AdaptiveSendButton.IsEnabled = !state.AdaptiveSubmitting && !state.Pane.AdaptiveChanging;
        ApplyAdaptiveToggleTheme(state, EffectivePaneTheme(state.Pane));
        state.ScreenshotButton.HorizontalAlignment = HorizontalAlignment.Right;
        state.ScreenshotButton.VerticalAlignment = VerticalAlignment.Bottom;
        state.ScreenshotButton.Margin = new Thickness(0, 0, 9, 8);
        ToolTip.SetTip(
            state.AdaptiveToggleButton,
            pending
                ? "Adaptive will create this Codex session when you send its first routed prompt"
                : enabled
                    ? "Adaptive routes prompts submitted in the native composer; click to restore manual model selection"
                    : "Automatically choose a Codex model and reasoning effort for each native prompt");
    }

    private void UpdatePaneAdaptiveControls(TerminalPaneState pane)
    {
        foreach (var state in _openTabs.Values.Where(candidate => ReferenceEquals(candidate.Pane, pane)))
            UpdateAdaptiveControls(state);
    }

    private async Task SetPaneAdaptiveEnabledAsync(TerminalPaneState pane, bool enabled)
    {
        if (pane.AdaptiveChanging || pane.AdaptiveEnabled == enabled)
        {
            UpdatePaneAdaptiveControls(pane);
            return;
        }
        var previousEnabled = pane.AdaptiveEnabled;
        pane.AdaptiveChanging = true;
        pane.AdaptiveEnabled = enabled;
        UpdatePaneAdaptiveControls(pane);
        try
        {
            var launched = _openTabs.Values
                .Where(state => ReferenceEquals(state.Pane, pane)
                    && IsCodexSession(state)
                    && state.IsLaunched)
                .ToList();
            var reconnecting = launched.Where(state => !IsPendingCodexSession(state)).ToList();
            if (reconnecting.Count > 0)
            {
                SetStatus(
                    $"{(enabled ? "Enabling" : "Disabling")} Adaptive · reconnecting {reconnecting.Count} Codex terminal{(reconnecting.Count == 1 ? string.Empty : "s")}…",
                    StartingBrush);
            }
            else if (enabled && launched.Any(IsPendingCodexSession))
            {
                SetStatus("Adaptive enabled · the first routed prompt will create and attach this Codex session…", StartingBrush);
            }
            foreach (var state in reconnecting)
                await RestartTerminalForAdaptiveModeAsync(state);
            await SaveWorkspaceAsync();
            SetStatus(
                enabled
                    ? $"Adaptive enabled for {PaneLabel(pane)} · use the native prompt composer"
                    : $"Adaptive disabled for {PaneLabel(pane)} · manual /model control is available",
                RunningBrush);
        }
        catch (Exception ex)
        {
            pane.AdaptiveEnabled = previousEnabled;
            NativeLog.Write($"Adaptive terminal mode change failed: {ex}");
            SetStatus($"Could not change Adaptive mode: {ex.Message}", ErrorBrush);
        }
        finally
        {
            pane.AdaptiveChanging = false;
            UpdatePaneAdaptiveControls(pane);
        }
    }

    private async Task RestartTerminalForAdaptiveModeAsync(SessionTabState state)
    {
        CancelTerminalReconnect(state, suppress: true);
        EndTerminalStartupReveal(state);
        try { await _api.KillTerminalAsync(state.Key, providerId: state.ProviderId); }
        catch (Exception ex) { NativeLog.Write($"Adaptive PTY restart could not stop {state.Key}: {ex.Message}"); }
        state.Terminal.Kill();
        state.IsRunning = false;
        state.IsLaunched = false;
        await Task.Delay(100);
        state.SuppressReconnect = false;
        await EnsureTerminalLaunchedAsync(state);
    }

    private async Task SubmitAdaptivePromptAsync(SessionTabState state)
    {
        if (!IsCodexSession(state) || !state.Pane.AdaptiveEnabled) return;
        var text = state.AdaptivePromptBox.Text?.Trim();
        if (string.IsNullOrWhiteSpace(text) || state.AdaptiveSubmitting) return;

        var temporaryKey = IsPendingCodexSession(state) ? state.Key : null;
        if (temporaryKey is not null) CancelTerminalReconnect(state, suppress: true);
        state.AdaptiveSubmitting = true;
        state.AdaptiveRouteText.Text = "Routing prompt…";
        UpdateAdaptiveControls(state);
        try
        {
            var route = await _api.SubmitAdaptivePromptAsync(
                state.Key,
                text,
                state.Pane.AdaptivePreference,
                state.WorkingDirectory);
            if (temporaryKey is not null)
            {
                var sessionId = route.SessionId
                    ?? throw new InvalidDataException("Adaptive did not return the new Codex session ID.");
                if (state.Key == temporaryKey) ApplySessionRekey(temporaryKey, sessionId);
                await RestartTerminalForAdaptiveModeAsync(state);
            }
            state.AdaptivePromptBox.Text = string.Empty;
            var modelLabel = string.IsNullOrWhiteSpace(route.DisplayName) ? route.Model : route.DisplayName;
            var routingSource = route.ClassifierUsed ? "model-assisted" : "local rules";
            state.AdaptiveRouteText.Text =
                $"{modelLabel} · {route.Effort} · {route.Level} · {routingSource}";
            ToolTip.SetTip(
                state.AdaptiveRouteText,
                $"{route.Reason} · confidence {route.Confidence:P0}");
            if (state.Session is not null) state.Session.Status = "active";
            SetStatus(
                $"Adaptive sent · {modelLabel} · {route.Effort} · {route.Level}",
                RunningBrush);
        }
        catch (Exception ex)
        {
            state.SuppressReconnect = false;
            state.AdaptiveRouteText.Text = "Routing failed · prompt preserved";
            NativeLog.Write($"Adaptive prompt failed for {state.Key}: {ex}");
            SetStatus($"Adaptive prompt failed: {ex.Message}", ErrorBrush);
        }
        finally
        {
            state.AdaptiveSubmitting = false;
            UpdateAdaptiveControls(state);
        }
    }

    private void UpdatePaneEmptyStates()
    {
        foreach (var pane in _panes)
            if (pane.EmptyState is not null) pane.EmptyState.IsVisible = !PaneContentTabs(pane).Any();
    }

    private void ConstrainMainContentHeight()
    {
        var availableHeight = Bounds.Height - AppHeader.Bounds.Height - AppFooter.Bounds.Height;
        if (availableHeight > 0)
        {
            MainContentGrid.Height = availableHeight;
            MainContentGrid.MaxHeight = availableHeight;
        }
    }

    private async void OnWindowKeyDown(object? sender, KeyEventArgs e)
    {
        var primary = (e.KeyModifiers & (OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control)) != 0;
        var shift = (e.KeyModifiers & KeyModifiers.Shift) != 0;
        if (primary && e.Key == Key.K)
        {
            if (!SidebarBorder.IsVisible)
            {
                _settings = _settings with { SidebarCollapsed = false };
                ApplySidebarState();
            }
            SearchTextBox.Focus();
            SearchTextBox.SelectAll();
            e.Handled = true;
            return;
        }
        if (primary && shift && e.Key == Key.N)
        {
            ShowNewSessionChooser(SidebarBorder.IsVisible ? NewSessionButton : CompactNewSessionButton);
            e.Handled = true;
            return;
        }
        if (primary && e.Key == Key.R)
        {
            await RefreshAllAsync();
            e.Handled = true;
            return;
        }
        if (primary && e.Key == Key.W)
        {
            var state = _openTabs.Values.FirstOrDefault(candidate =>
                ReferenceEquals(candidate.Pane, _activePane)
                && ReferenceEquals(candidate.Tab, _activePane.Tabs.SelectedItem));
            if (state is not null)
            {
                await DetachTabAsync(state);
            }
            else if (_activePane.Tabs.SelectedItem is TabItem selected && !ReferenceEquals(selected, DashboardTab))
            {
                RemovePreviewTab(selected);
            }
            e.Handled = true;
            return;
        }
        if (e.Key == Key.Escape)
        {
            SetActivePane(_panes[0]);
            WorkspaceTabs.SelectedItem = DashboardTab;
            e.Handled = true;
        }
    }

    private async void OnWindowOpened(object? sender, EventArgs e)
    {
        _settings = await _settingsStore.LoadAsync();
        _api.UseProvider(string.IsNullOrWhiteSpace(_settings.ProviderId) ? "codex" : _settings.ProviderId);
        InitializeSelectors();
        InitializeNavigation();
        InitializeAnalytics();
        ApplyTheme(DashboardTheme.Find(_settings.StyleId));
        ApplyTextSize(DashboardTextSize.Find(_settings.TextSizeId));
        ApplySidebarState();
        await ReconcileDashboardRepositoryAsync();
        if (await EnsureDashboardServiceAsync())
        {
            await InitializeProviderSelectorAsync();
            await RefreshAllAsync();
            StartStatusFeed();
        }
        else
        {
            SessionCountText.Text = "Dashboard setup required";
            EnvSummaryText.Text = "Local data service unavailable";
        }
        await RestoreWorkspaceAsync();
        UpdateTerminalTabContentHeights();
        Dispatcher.UIThread.Post(UpdateTerminalTabContentHeights, DispatcherPriority.Loaded);
        _workspaceReady = true;
        await SaveWorkspaceAsync();
        _updateService.CleanupPreviousInstall(_platform);
        _refreshTimer.Start();
        _updateCheckTimer.Start();
        _ = CheckForUpdateAsync(reportCurrent: false);
    }

    private async Task InitializeProviderSelectorAsync()
    {
        try
        {
            _providers = await _api.GetProvidersAsync();
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Provider catalog unavailable; using native fallbacks: {ex.Message}");
            _providers =
            [
                new ProviderStatus { Id = "codex", Label = "Codex", Noun = "Codex session", Available = true },
                new ProviderStatus { Id = "devin", Label = "Devin", Noun = "Devin session", Available = true },
            ];
        }

        if (_providers.Count == 0)
            _providers.Add(new ProviderStatus { Id = "codex", Label = "Codex", Noun = "Codex session", Available = true });
        var selected = _providers.FirstOrDefault(provider => provider.Id == _settings.ProviderId)
            ?? _providers.FirstOrDefault(provider => provider.Id == "codex")
            ?? _providers[0];
        _api.UseProvider(selected.Id);
        _settings = _settings with { ProviderId = selected.Id };

        _initializingProviderSelector = true;
        ProviderComboBox.ItemsSource = _providers;
        ProviderComboBox.SelectedItem = selected;
        _initializingProviderSelector = false;
        ApplyProviderChrome();
    }

    private async void OnProviderChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (_initializingProviderSelector || ProviderComboBox.SelectedItem is not ProviderStatus provider
            || provider.Id == _api.ProviderId) return;

        ProviderComboBox.IsEnabled = false;
        try
        {
            while (_refreshing) await Task.Delay(50);
            await StopStatusFeedAsync();
            _searchCancellation?.Cancel();
            _api.UseProvider(provider.Id);
            _settings = _settings with { ProviderId = provider.Id };
            _sessions = [];
            _archivedSessions = [];
            _repos = [];
            _searchResults = null;
            _stats = null;
            _rateLimits = null;
            ApplyProviderChrome();
            UpdateRepoFilter();
            ApplySessionFilter();
            RenderRateLimits(null);
            SetDashboardConnectionState(false);
            if (_dashboardStatus is not null) RenderProviderStatus(_dashboardStatus);
            SetStatus($"Switching dashboard to {CurrentProviderLabel}…", StartingBrush);
            await PersistSettingsAsync();
            await RefreshAllAsync();
            StartStatusFeed();
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Provider switch failed: {ex}");
            SetStatus($"Could not switch provider: {ex.Message}", ErrorBrush);
        }
        finally
        {
            ProviderComboBox.IsEnabled = true;
        }
    }

    private string CurrentProviderLabel => ProviderLabel(_api.ProviderId);

    private string ProviderLabel(string? providerId) =>
        _providers.FirstOrDefault(provider => provider.Id == providerId)?.DisplayLabel
        ?? (providerId?.Equals("devin", StringComparison.OrdinalIgnoreCase) == true ? "Devin" : "Codex");

    private string ProviderNoun(string? providerId)
    {
        var provider = _providers.FirstOrDefault(candidate => candidate.Id == providerId);
        return string.IsNullOrWhiteSpace(provider?.Noun)
            ? $"{ProviderLabel(providerId)} session"
            : provider.Noun;
    }

    private void ApplyProviderChrome()
    {
        var label = CurrentProviderLabel;
        Title = $"{label} Native Dashboard";
        HeaderTitleText.Text = $"{label.ToUpperInvariant()} NATIVE DASHBOARD";
        ProviderServiceHeadingText.Text = $"{label.ToUpperInvariant()} SERVICE";
        TerminalPathText.Text = _platform.UsesWsl
            ? $"Terminal path: native view → persistent WSL2 PTY → {label}"
            : $"Terminal path: native view → persistent {_platform.DisplayName} PTY → {label}";
        var newSessionShortcut = OperatingSystem.IsMacOS() ? "Cmd+Shift+N" : "Ctrl+Shift+N";
        ToolTip.SetTip(NewSessionButton, $"New {label} or {_platform.LocalShellLabel} session ({newSessionShortcut})");
        ToolTip.SetTip(CompactNewSessionButton, $"New {label} or {_platform.LocalShellLabel} session ({newSessionShortcut})");
        ToolTip.SetTip(LaunchBrowserButton, $"Open the browser-based {label} dashboard");
        if (Bounds.Width > 0) ApplyResponsiveHeaderLayout(Bounds.Width);
        UpdateHeaderConnectionIndicator();
    }

    private void ApplyResponsiveHeaderLayout(double width)
    {
        var compact = width < 1100;
        AgentLabelText.IsVisible = !compact;
        StyleLabelText.IsVisible = !compact;
        TextLabelText.IsVisible = !compact;
        EnvSummaryText.IsVisible = width >= 1180;
        HeaderTitleText.Text = compact
            ? CurrentProviderLabel.ToUpperInvariant()
            : $"{CurrentProviderLabel.ToUpperInvariant()} NATIVE DASHBOARD";
        LaunchBrowserButton.Content = width < 1050 ? "Browser" : "Launch in Browser";
    }

    private void InitializeSelectors()
    {
        _initializingSelectors = true;
        ThemeComboBox.ItemsSource = DashboardTheme.All.Select(theme => theme.Label).ToList();
        ThemeComboBox.SelectedIndex = Math.Max(0, DashboardTheme.All.ToList().FindIndex(theme => theme.Id == _settings.StyleId));
        TextSizeComboBox.ItemsSource = DashboardTextSize.All.Select(size => size.Label).ToList();
        TextSizeComboBox.SelectedIndex = Math.Max(0, DashboardTextSize.All.ToList().FindIndex(size => size.Id == _settings.TextSizeId));
        _initializingSelectors = false;
    }

    private void InitializeNavigation()
    {
        _initializingNavigation = true;
        ShowHeadlessCheckBox.IsChecked = _settings.ShowHeadless;
        ArchivedCheckBox.IsChecked = _settings.IncludeArchived;
        SearchTextBox.Text = _settings.SearchQuery;
        NeedsInputCheckBox.IsChecked = _settings.NeedsInputOnly;
        ColdDaysComboBox.ItemsSource = new[] { 1, 3, 7, 14, 30 }.Select(days => $"> {days}d").ToList();
        ColdDaysComboBox.SelectedIndex = Math.Max(0, new[] { 1, 3, 7, 14, 30 }.ToList().IndexOf(_settings.ColdDays));
        _initializingNavigation = false;
    }

    private void InitializeAnalytics()
    {
        _initializingAnalytics = true;
        var windows = new[] { "1d", "2d", "7d", "14d", "30d", "all" };
        AnalyticsWindowComboBox.ItemsSource = windows.Select(value => value == "all" ? "All time" : value).ToList();
        AnalyticsWindowComboBox.SelectedIndex = Math.Max(0, Array.IndexOf(windows, _settings.AnalyticsWindow));
        var cohorts = new[] { "combined", "triage", "codex" };
        StatsCohortComboBox.ItemsSource = new[] { "Combined", "Triage only", "Native Codex" };
        StatsCohortComboBox.SelectedIndex = Math.Max(0, Array.IndexOf(cohorts, _settings.StatsMode));
        _initializingAnalytics = false;
    }

    private async Task<bool> EnsureDashboardServiceAsync(CancellationToken cancellationToken = default)
    {
        if (_serviceStopRequested)
        {
            SetStatus("Local dashboard service is stopped. Use the menu-bar icon to start it.", StartingBrush);
            return false;
        }
        SetStatus("Connecting to ui-my-cli data service…", StartingBrush);
        if (await _api.TryUseExistingServiceAsync(cancellationToken))
        {
            SetStatus($"Dashboard connected on {_api.ConnectedPort} · persistent terminals enabled", RunningBrush);
            return true;
        }

        try
        {
            if (_platform.Platform == NativePlatform.MacOS)
            {
                var readiness = DashboardRepositoryLocator.Inspect(_settings.DashboardWorkingDirectory);
                if (!readiness.IsReady)
                {
                    var message = $"Dashboard setup required: {readiness.DescribeFailure()}";
                    NativeLog.Write(message);
                    SetStatus(message, ErrorBrush);
                    return false;
                }
            }
            var hostExecutable = Path.Combine(AppContext.BaseDirectory, _platform.TerminalHostFileName);
            foreach (var port in DashboardServicePorts.PrivateCandidates)
            {
                _api.UsePrivateService(port);
                // A previous native UI can leave its intentionally persistent
                // service alive while a new UI is starting. Recheck immediately
                // before spawning so a short probe race does not create a noisy
                // EADDRINUSE child process.
                if (await _api.IsAvailableAsync(cancellationToken))
                {
                    SetStatus($"Dashboard reconnected on {port} · persistent terminals enabled", RunningBrush);
                    return true;
                }
                _serviceManager.EnsureStarted(
                    _platform.Platform,
                    hostExecutable,
                    _settings.Distribution,
                    _settings.DashboardWorkingDirectory,
                    Environment.GetEnvironmentVariable("NODE_BIN"),
                    port);
                var exited = false;
                for (var attempt = 0; attempt < 20; attempt++)
                {
                    await Task.Delay(500, cancellationToken);
                    if (await _api.IsAvailableAsync(cancellationToken))
                    {
                        SetStatus(
                            $"Started ui-my-cli data service on {port} · persistent terminals enabled",
                            RunningBrush);
                        return true;
                    }
                    if (!_serviceManager.TryGetExitCode(out var exitCode)) continue;
                    NativeLog.Write(
                        $"Dashboard service candidate port {port} exited with code {exitCode}; trying the next private port.");
                    exited = true;
                    break;
                }
                if (exited) continue;
                throw new TimeoutException(
                    $"The native dashboard data service did not answer on port {port}. See {NativeLog.FilePath}");
            }
            throw new InvalidOperationException(
                $"No private dashboard port from {DashboardServicePorts.FirstPrivate} through " +
                $"{DashboardServicePorts.LastPrivate} could start the data service. See {NativeLog.FilePath}");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Dashboard service startup failed: {ex}");
            SetStatus($"Dashboard data unavailable: {ex.Message}", ErrorBrush);
            return false;
        }
    }

    private async Task ReconcileDashboardRepositoryAsync()
    {
        if (_platform.Platform != NativePlatform.MacOS) return;
        var resolved = DashboardRepositoryLocator.Find(
            AppContext.BaseDirectory,
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            _settings.DashboardWorkingDirectory);
        if (string.Equals(resolved, _settings.DashboardWorkingDirectory, StringComparison.Ordinal)) return;

        var readiness = DashboardRepositoryLocator.Inspect(resolved);
        if (!readiness.IsReady)
        {
            NativeLog.Write(
                $"Keeping configured dashboard checkout '{_settings.DashboardWorkingDirectory}' " +
                $"instead of incomplete candidate '{resolved}'.");
            return;
        }

        var previous = _settings.DashboardWorkingDirectory;
        _settings = _settings with { DashboardWorkingDirectory = resolved };
        await _settingsStore.SaveAsync(_settings);
        NativeLog.Write($"Replaced unavailable dashboard checkout '{previous}' with '{resolved}'.");
    }

    private void StartStatusFeed()
    {
        if (_statusFeed is not null) return;
        var providerId = _api.ProviderId;
        _statusFeed = new DashboardStatusFeed(_api.StatusWebSocketUri);
        _statusFeed.SessionsReceived += sessions => Dispatcher.UIThread.Post(() =>
        {
            if (_api.ProviderId == providerId) ApplyPushedSessions(sessions);
        });
        _statusFeed.SessionRekeyed += (temporaryKey, realId) =>
            Dispatcher.UIThread.Post(() =>
            {
                if (_api.ProviderId == providerId) ApplySessionRekey(temporaryKey, realId);
            });
        _statusFeed.PendingSessionExpired += temporaryKey =>
            Dispatcher.UIThread.Post(() =>
            {
                if (_api.ProviderId == providerId) RemoveExpiredPendingSession(temporaryKey);
            });
        _statusFeed.ConnectionChanged += connected => Dispatcher.UIThread.Post(() =>
        {
            if (_api.ProviderId != providerId) return;
            SetDashboardConnectionState(connected);
            if (connected) SetStatus($"{CurrentProviderLabel} live push connected · {_sessions.Count:N0} sessions", RunningBrush);
        });
        _statusFeed.Start();
    }

    private async Task StopStatusFeedAsync()
    {
        var feed = _statusFeed;
        _statusFeed = null;
        if (feed is not null) await feed.DisposeAsync();
    }

    private void ApplyPushedSessions(IReadOnlyList<DashboardSession> sessions)
    {
        var ordered = sessions.OrderByDescending(session => session.LastActivityAt).ToList();
        if (SessionListsMateriallyEqual(_sessions, ordered)) return;

        _sessions = ordered;
        ReconcilePendingSessions();
        UpdateRepoFilter();
        ApplySessionFilter();
        RenderLatestPrompt();
        UpdateOpenTabStatuses();
    }

    private static bool SessionListsMateriallyEqual(
        IReadOnlyList<DashboardSession> current,
        IReadOnlyList<DashboardSession> incoming)
    {
        if (current.Count != incoming.Count) return false;
        for (var index = 0; index < current.Count; index++)
        {
            var left = current[index];
            var right = incoming[index];
            if (left.Id != right.Id
                || left.Provider != right.Provider
                || left.Source != right.Source
                || left.ThreadSource != right.ThreadSource
                || left.Title != right.Title
                || left.WorkingDir != right.WorkingDir
                || left.Project != right.Project
                || left.Model != right.Model
                || left.ReasoningEffort != right.ReasoningEffort
                || left.PermissionMode != right.PermissionMode
                || left.Status != right.Status
                || left.Snippet != right.Snippet
                || left.FirstUserPrompt != right.FirstUserPrompt
                || left.LastUserPrompt != right.LastUserPrompt
                || left.HasSubagents != right.HasSubagents
                || left.Archived != right.Archived
                || left.LastActivityAt != right.LastActivityAt
                || left.CreatedAt != right.CreatedAt)
            {
                return false;
            }
        }
        return true;
    }

    private void ApplySessionRekey(string temporaryKey, string realId)
    {
        if (string.IsNullOrWhiteSpace(temporaryKey) || string.IsNullOrWhiteSpace(realId)
            || !_openTabs.TryGetValue(ProviderTabKey(_api.ProviderId, temporaryKey), out var state)
            || state.Kind != TerminalSessionKind.Codex) return;
        var session = _sessions.FirstOrDefault(candidate => candidate.Id == realId);
        _openTabs.Remove(OpenTabRegistryKey(state));
        state.Key = realId;
        state.Session = session;
        state.TitleBlock.Text = session?.DisplayTitle ?? state.TitleBlock.Text;
        AutomationProperties.SetName(state.Tab, state.TitleBlock.Text ?? ProviderNoun(state.ProviderId));
        state.RenameBox.Text = session?.DisplayTitle ?? state.RenameBox.Text;
        state.ArchiveButton.IsVisible = session is not null;
        state.SummaryButton.IsVisible = session is not null;
        _openTabs[OpenTabRegistryKey(state)] = state;
        if (session is not null) _ = LoadSessionDetailsAsync(state, session);
        UpdatePaneAdaptiveControls(state.Pane);
        SetStatus($"Session registered · {realId[..Math.Min(8, realId.Length)]}", RunningBrush);
        _ = SaveWorkspaceAsync();
    }

    private void RemoveExpiredPendingSession(string temporaryKey)
    {
        if (!_openTabs.TryGetValue(ProviderTabKey(_api.ProviderId, temporaryKey), out var state)
            || state.Kind != TerminalSessionKind.Codex) return;
        CancelTerminalReconnect(state, suppress: true);
        state.Terminal.Kill();
        state.Pane.Tabs.Items.Remove(state.Tab);
        _openTabs.Remove(OpenTabRegistryKey(state));
        UpdatePaneAdaptiveControls(state.Pane);
        SelectPaneFallback(state.Pane);
        UpdatePaneEmptyStates();
        SetStatus($"The new {ProviderLabel(state.ProviderId)} session did not register and was stopped.", ErrorBrush);
        _ = SaveWorkspaceAsync();
    }

    private async Task RefreshAllAsync()
    {
        if (_refreshing)
        {
            return;
        }

        _refreshing = true;
        RefreshButton.IsEnabled = false;
        try
        {
            var sessionsTask = _api.GetSessionsAsync();
            var archivedTask = _api.GetArchivedSessionsAsync();
            var reposTask = _api.GetReposAsync();
            var statsTask = _api.GetStatsAsync(_settings.StatsMode);
            var statusTask = _api.GetStatusAsync();
            await Task.WhenAll(sessionsTask, archivedTask, reposTask, statsTask, statusTask);
            var sessions = sessionsTask.Result.OrderByDescending(session => session.LastActivityAt).ToList();
            var archivedSessions = archivedTask.Result.OrderByDescending(session => session.LastActivityAt).ToList();
            var sessionsChanged = !SessionListsMateriallyEqual(_sessions, sessions);
            var archivedSessionsChanged = !SessionListsMateriallyEqual(_archivedSessions, archivedSessions);
            if (sessionsChanged) _sessions = sessions;
            if (archivedSessionsChanged) _archivedSessions = archivedSessions;
            _repos = reposTask.Result;
            _stats = statsTask.Result;
            _dashboardStatus = statusTask.Result;
            UpdateRepoFilter();
            if (sessionsChanged || archivedSessionsChanged) ApplySessionFilter();
            RenderLatestPrompt();
            RenderStats(_stats);
            RenderProviderStatus(_dashboardStatus);
            if (sessionsChanged) UpdateOpenTabStatuses();
            SetStatus($"{CurrentProviderLabel} live · {_sessions.Count} sessions · persistent {_platform.DisplayName} terminals", RunningBrush);
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Dashboard refresh failed: {ex}");
            SetStatus($"Refresh failed: {ex.Message}", ErrorBrush);
        }
        finally
        {
            _refreshing = false;
            RefreshButton.IsEnabled = true;
        }
    }

    private async Task RefreshSessionsAsync()
    {
        if (_refreshing)
        {
            return;
        }

        _refreshing = true;
        try
        {
            var sessions = (await _api.GetSessionsAsync())
                .OrderByDescending(session => session.LastActivityAt)
                .ToList();
            var sessionsChanged = !SessionListsMateriallyEqual(_sessions, sessions);
            if (sessionsChanged) _sessions = sessions;
            var archivedSessionsChanged = false;
            if (ArchivedCheckBox.IsChecked == true)
            {
                var archivedSessions = (await _api.GetArchivedSessionsAsync())
                    .OrderByDescending(session => session.LastActivityAt)
                    .ToList();
                archivedSessionsChanged = !SessionListsMateriallyEqual(_archivedSessions, archivedSessions);
                if (archivedSessionsChanged) _archivedSessions = archivedSessions;
            }
            ReconcilePendingSessions();
            if (sessionsChanged || archivedSessionsChanged) ApplySessionFilter();
            if (sessionsChanged) UpdateOpenTabStatuses();
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Session refresh failed: {ex.Message}");
        }
        finally
        {
            _refreshing = false;
        }
    }

    private void UpdateRepoFilter()
    {
        var selectedPath = (RepoComboBox.SelectedItem as RepoFilter)?.WorkingDir
            ?? _settings.SelectedRepo
            ?? _settings.SelectedRepos?.FirstOrDefault();
        var filters = new List<RepoFilter> { new("All projects", null) };
        filters.AddRange(_repos.Select(repo => new RepoFilter(
            $"{repo.Project} ({_sessions.Count(session => session.WorkingDir == repo.WorkingDir):N0})",
            repo.WorkingDir)));
        var wasInitializing = _initializingNavigation;
        _initializingNavigation = true;
        try
        {
            RepoComboBox.ItemsSource = filters;
            RepoComboBox.SelectedItem = filters.FirstOrDefault(filter => filter.WorkingDir == selectedPath) ?? filters[0];
        }
        finally
        {
            _initializingNavigation = wasInitializing;
        }
        UpdateSessionFilterSummary();
    }

    private void ApplySessionFilter()
    {
        var query = (SearchTextBox.Text ?? string.Empty).Trim();
        IEnumerable<DashboardSession> filtered = _searchResults is not null && !string.IsNullOrWhiteSpace(query)
            ? _searchResults
            : ArchivedCheckBox.IsChecked == true
                ? _sessions.Concat(_archivedSessions)
                : _sessions;
        if (ShowHeadlessCheckBox.IsChecked != true)
        {
            filtered = filtered.Where(session => !session.IsHeadless);
        }
        var selectedRepo = (RepoComboBox.SelectedItem as RepoFilter)?.WorkingDir;
        if (!string.IsNullOrWhiteSpace(selectedRepo))
            filtered = filtered.Where(session => session.WorkingDir == selectedRepo);
        if (NeedsInputCheckBox.IsChecked == true)
        {
            filtered = filtered.Where(session => session.Status == "question");
        }
        if (!string.IsNullOrWhiteSpace(query) && _searchResults is null)
        {
            filtered = filtered.Where(session =>
                Contains(session.Title, query)
                || Contains(session.Project, query)
                || Contains(session.FirstUserPrompt, query)
                || Contains(session.LastUserPrompt, query));
        }

        ResetSessionDividerAnimations();
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var visible = filtered
            .OrderBy(session => SessionAgeGrouping.IsCold(
                session.Status, session.LastActivityAt, now, _settings.ColdDays) ? 1 : 0)
            .ThenByDescending(session => session.LastActivityAt)
            .ToList();
        SessionsList.ItemsSource = visible;
        CompactSessionsList.ItemsSource = visible;
        var sourceCount = ArchivedCheckBox.IsChecked == true ? _sessions.Count + _archivedSessions.Count : _sessions.Count;
        var olderCount = visible.Count(session => SessionAgeGrouping.IsCold(
            session.Status, session.LastActivityAt, now, _settings.ColdDays));
        SessionCountText.Text = $"{visible.Count} of {sourceCount} · {olderCount} older than {_settings.ColdDays}d";
        UpdateSessionFilterSummary();
    }

    private void UpdateSessionFilterSummary()
    {
        var parts = new List<string>
        {
            (RepoComboBox.SelectedItem as RepoFilter)?.Label ?? "All projects",
            $"> {_settings.ColdDays}d grouped",
        };
        if (ShowHeadlessCheckBox.IsChecked == true) parts.Add("headless");
        if (ArchivedCheckBox.IsChecked == true) parts.Add("archive");
        if (NeedsInputCheckBox.IsChecked == true) parts.Add("waiting");
        SessionFiltersSummaryText.Text = string.Join(" · ", parts);
    }

    private static bool Contains(string? value, string query) =>
        value?.Contains(query, StringComparison.OrdinalIgnoreCase) == true;

    private void ReconcilePendingSessions()
    {
        var changed = false;
        foreach (var state in _openTabs.Values
                     .Where(state => state.Kind == TerminalSessionKind.Codex
                         && state.ProviderId == _api.ProviderId
                         && state.Session is null
                         && state.IsLaunched)
                     .ToList())
        {
            var candidate = _sessions
                .Where(session => session.WorkingDir == state.WorkingDirectory)
                .Where(session => !state.KnownSessionIdsAtLaunch.Contains(session.Id))
                .Where(session => session.CreatedAt >= state.LaunchedAt - 5)
                .Where(session => !_openTabs.Values.Any(other => other != state
                    && other.ProviderId == state.ProviderId
                    && other.Session?.Id == session.Id))
                .OrderBy(session => Math.Abs(session.CreatedAt - state.LaunchedAt))
                .FirstOrDefault();
            if (candidate is null) continue;

            _openTabs.Remove(OpenTabRegistryKey(state));
            state.Key = candidate.Id;
            state.Session = candidate;
            state.TitleBlock.Text = candidate.DisplayTitle;
            AutomationProperties.SetName(state.Tab, candidate.DisplayTitle);
            state.RenameBox.Text = candidate.DisplayTitle;
            state.ArchiveButton.IsVisible = true;
            state.SummaryButton.IsVisible = true;
            _openTabs[OpenTabRegistryKey(state)] = state;
            changed = true;
            _ = LoadSessionDetailsAsync(state, candidate);
            UpdatePaneAdaptiveControls(state.Pane);
            SetStatus($"New session registered · {candidate.Id[..8]}", RunningBrush);
        }
        if (changed) _ = SaveWorkspaceAsync();
    }

    private async Task RestoreWorkspaceAsync()
    {
        if (_settings.SavedPaneLayouts.Count > 0)
        {
            await RestorePaneWorkspaceAsync();
            return;
        }
        foreach (var id in _settings.SavedSessionIds.Distinct(StringComparer.Ordinal))
        {
            var session = _sessions.FirstOrDefault(candidate => candidate.Id == id && !candidate.IsHeadless);
            if (session is not null) await OpenSessionAsync(session, activate: false, launch: false, targetPane: _panes[0]);
        }
        if (!string.IsNullOrWhiteSpace(_settings.ActiveSessionId)
            && _openTabs.TryGetValue(ProviderTabKey(_api.ProviderId, _settings.ActiveSessionId), out var active))
        {
            AttachTab(active);
            await EnsureTerminalLaunchedAsync(active);
        }
        else
        {
            SetActivePane(_panes[0]);
            WorkspaceTabs.SelectedItem = DashboardTab;
        }
    }

    private async Task RestorePaneWorkspaceAsync()
    {
        _restoringPaneLayout = true;
        try
        {
            var layouts = _settings.SavedPaneLayouts;
            var primaryLayout = layouts[0];
            _panes[0].Width = Math.Max(MinimumPaneWidth, primaryLayout.Width);
            _panes[0].InspectorHeight = Math.Clamp(
                primaryLayout.InspectorHeight, InspectorMinimumHeight, InspectorMaximumHeight);
            _panes[0].InspectorCollapsed = primaryLayout.InspectorCollapsed;
            _panes[0].AdaptiveEnabled = primaryLayout.AdaptiveEnabled;
            _panes[0].AdaptivePreference = NormalizeAdaptivePreference(primaryLayout.AdaptivePreference);
            _panes[0].StyleId = NormalizePaneStyleId(primaryLayout.StyleId);
            SyncPaneThemeSelector(_panes[0]);
            ApplyPaneTheme(_panes[0]);
            for (var index = 1; index < layouts.Count; index++)
            {
                var layout = layouts[index];
                var restoredPane = CreateSecondaryPane(
                    layout.Id,
                    Math.Max(MinimumPaneWidth, layout.Width),
                    Math.Clamp(layout.InspectorHeight, InspectorMinimumHeight, InspectorMaximumHeight));
                restoredPane.InspectorCollapsed = layout.InspectorCollapsed;
                restoredPane.AdaptiveEnabled = layout.AdaptiveEnabled;
                restoredPane.AdaptivePreference = NormalizeAdaptivePreference(layout.AdaptivePreference);
                restoredPane.StyleId = NormalizePaneStyleId(layout.StyleId);
                SyncPaneThemeSelector(restoredPane);
                ApplyPaneTheme(restoredPane);
                _panes.Add(restoredPane);
            }
            FitPaneWidthsToViewport();
            RebuildPaneHost(equalize: false);

            static string SavedProviderId(NativePaneTabLayout tab) =>
                string.IsNullOrWhiteSpace(tab.ProviderId) ? "codex" : tab.ProviderId;
            var providerIds = layouts
                .SelectMany(layout => layout.SavedTabs)
                .Where(tab => tab.Kind is "codex" or "codex-pending" or "provider" or "provider-pending" or "preview")
                .Select(SavedProviderId)
                .Append(_api.ProviderId)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var sessionsByProvider = new Dictionary<string, List<DashboardSession>>(StringComparer.Ordinal);
            var archivedByProvider = new Dictionary<string, List<DashboardSession>>(StringComparer.Ordinal);
            var terminalsByProvider = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            foreach (var providerId in providerIds)
            {
                try
                {
                    sessionsByProvider[providerId] = providerId == _api.ProviderId
                        ? _sessions
                        : await _api.GetSessionsAsync(providerId: providerId);
                    archivedByProvider[providerId] = providerId == _api.ProviderId
                        ? _archivedSessions
                        : await _api.GetArchivedSessionsAsync(providerId: providerId);
                    terminalsByProvider[providerId] = await _api.GetActiveTerminalIdsAsync(providerId: providerId);
                }
                catch (Exception ex)
                {
                    NativeLog.Write($"Could not restore {providerId} workspace state: {ex.Message}");
                    sessionsByProvider[providerId] = [];
                    archivedByProvider[providerId] = [];
                    terminalsByProvider[providerId] = [];
                }
            }

            for (var index = 0; index < layouts.Count && index < _panes.Count; index++)
            {
                var pane = _panes[index];
                var layout = layouts[index];
                foreach (var savedTab in layout.SavedTabs)
                {
                    switch (savedTab.Kind)
                    {
                        case "dashboard":
                            break;
                        case "codex":
                        case "provider":
                        {
                            var providerId = SavedProviderId(savedTab);
                            var sessionId = savedTab.SessionId ?? savedTab.Key;
                            var session = sessionsByProvider[providerId]
                                .FirstOrDefault(candidate => candidate.Id == sessionId && !candidate.IsHeadless);
                            if (session is not null)
                                await OpenSessionAsync(session, activate: false, launch: false, targetPane: pane);
                            break;
                        }
                        case "codex-pending":
                        case "provider-pending":
                        {
                            var providerId = SavedProviderId(savedTab);
                            var registered = sessionsByProvider[providerId]
                                .Where(candidate => candidate.WorkingDir == savedTab.WorkingDirectory)
                                .Where(candidate => savedTab.LaunchedAt <= 0 || candidate.CreatedAt >= savedTab.LaunchedAt - 5)
                                .OrderBy(candidate => savedTab.LaunchedAt <= 0
                                    ? candidate.CreatedAt
                                    : Math.Abs(candidate.CreatedAt - savedTab.LaunchedAt))
                                .FirstOrDefault();
                            if (registered is not null)
                                await OpenSessionAsync(registered, activate: false, launch: false, targetPane: pane);
                            else if (terminalsByProvider[providerId].Contains(savedTab.Key))
                                RestorePendingProviderTab(savedTab, pane);
                            break;
                        }
                        case "ubuntu":
                        case "local-shell":
                            await OpenLocalShellSessionAsync(
                                savedTab.WorkingDirectory,
                                pane,
                                activate: false,
                                launch: false,
                                restoredKey: savedTab.Key,
                                restoredTitle: savedTab.Title);
                            break;
                        case "preview":
                        {
                            var providerId = SavedProviderId(savedTab);
                            var sessionId = savedTab.SessionId ?? savedTab.Key.Replace("preview:", string.Empty, StringComparison.Ordinal);
                            var session = sessionsByProvider[providerId]
                                .Concat(archivedByProvider[providerId])
                                .FirstOrDefault(candidate => candidate.Id == sessionId);
                            if (session is not null) await OpenPreviewAsync(session, pane, activate: false);
                            break;
                        }
                    }
                }
                SelectSavedPaneTab(pane, layout.ActiveTabKey);
                ApplyPaneInspectorHeight(pane);
            }

            var activePane = _panes.FirstOrDefault(pane => pane.Id == _settings.ActivePaneId) ?? _panes[0];
            SetActivePane(activePane);
            foreach (var pane in _panes)
            {
                var activeState = _openTabs.Values.FirstOrDefault(state =>
                    ReferenceEquals(state.Pane, pane)
                    && ReferenceEquals(state.Tab, pane.Tabs.SelectedItem));
                if (activeState is not null) await EnsureTerminalLaunchedAsync(activeState);
            }
            UpdatePaneEmptyStates();
        }
        finally
        {
            _restoringPaneLayout = false;
        }
    }

    private void RestorePendingProviderTab(NativePaneTabLayout savedTab, TerminalPaneState pane)
    {
        var providerId = string.IsNullOrWhiteSpace(savedTab.ProviderId) ? "codex" : savedTab.ProviderId;
        if (_openTabs.ContainsKey(ProviderTabKey(providerId, savedTab.Key))) return;
        var state = CreateTerminalTab(
            savedTab.Key,
            savedTab.Title,
            savedTab.WorkingDirectory,
            session: null,
            kind: TerminalSessionKind.Codex,
            pane: pane,
            providerId: providerId);
        state.LaunchedAt = savedTab.LaunchedAt;
        _openTabs[OpenTabRegistryKey(state)] = state;
        AddTabToPane(pane, state.Tab);
        state.IsAttached = true;
        UpdatePaneAdaptiveControls(pane);
    }

    private void SelectSavedPaneTab(TerminalPaneState pane, string? activeTabKey)
    {
        if (string.IsNullOrWhiteSpace(activeTabKey))
        {
            if (ReferenceEquals(pane, _panes[0])) pane.Tabs.SelectedItem = DashboardTab;
            else pane.Tabs.SelectedItem = PaneContentTabs(pane).FirstOrDefault();
            return;
        }
        var match = pane.Tabs.Items.OfType<TabItem>().FirstOrDefault(tab => TabPersistenceKey(tab) == activeTabKey);
        match ??= pane.Tabs.Items.OfType<TabItem>().FirstOrDefault(tab =>
            _openTabs.Values.FirstOrDefault(state => ReferenceEquals(state.Tab, tab))?.Key == activeTabKey);
        if (match is not null) pane.Tabs.SelectedItem = match;
    }

    private async Task SaveWorkspaceAsync()
    {
        if (!_workspaceReady || _restoringPaneLayout) return;
        var active = _openTabs.Values.FirstOrDefault(state =>
            ReferenceEquals(state.Pane, _activePane)
            && ReferenceEquals(_activePane.Tabs.SelectedItem, state.Tab));
        _settings = _settings with
        {
            OpenSessionIds = _openTabs.Values
                .Where(state => state.IsAttached
                    && state.Session is not null
                    && state.ProviderId == _api.ProviderId)
                .Select(state => state.Session!.Id)
                .Distinct(StringComparer.Ordinal)
                .ToList(),
            ActiveSessionId = active?.ProviderId == _api.ProviderId ? active.Session?.Id : null,
            PaneLayouts = _panes.Select(CreatePaneLayout).ToList(),
            ActivePaneId = _activePane.Id,
            SidebarCollapsed = !SidebarBorder.IsVisible,
            SelectedRepo = (RepoComboBox.SelectedItem as RepoFilter)?.WorkingDir,
            SelectedRepos = (RepoComboBox.SelectedItem as RepoFilter)?.WorkingDir is string selectedRepo
                ? [selectedRepo]
                : [],
            ShowHeadless = ShowHeadlessCheckBox.IsChecked == true,
            IncludeArchived = ArchivedCheckBox.IsChecked == true,
            SearchQuery = SearchTextBox.Text ?? string.Empty,
            NeedsInputOnly = NeedsInputCheckBox.IsChecked == true,
            SidebarWidth = SidebarBorder.IsVisible ? MainContentGrid.ColumnDefinitions[0].ActualWidth : _settings.SidebarWidth,
        };
        await PersistSettingsAsync();
    }

    private NativePaneLayout CreatePaneLayout(TerminalPaneState pane)
    {
        var tabs = pane.Tabs.Items.OfType<TabItem>()
            .Select(CreateTabLayout)
            .Where(layout => layout is not null)
            .Cast<NativePaneTabLayout>()
            .ToList();
        return new NativePaneLayout(
            pane.Id,
            Math.Max(MinimumPaneWidth, pane.Width),
            Math.Clamp(pane.InspectorHeight, InspectorMinimumHeight, InspectorMaximumHeight),
            tabs,
            pane.Tabs.SelectedItem is TabItem selected ? TabPersistenceKey(selected) : null,
            pane.InspectorCollapsed,
            pane.AdaptiveEnabled,
            pane.AdaptivePreference,
            pane.StyleId);
    }

    private NativePaneTabLayout? CreateTabLayout(TabItem tab)
    {
        if (ReferenceEquals(tab, DashboardTab))
            return new NativePaneTabLayout("dashboard", "dashboard", null, string.Empty, "Dashboard overview");
        var state = _openTabs.Values.FirstOrDefault(candidate => ReferenceEquals(candidate.Tab, tab));
        if (state is not null)
        {
            var kind = state.Kind == TerminalSessionKind.LocalShell
                ? "local-shell"
                : state.Session is null ? "provider-pending" : "provider";
            return new NativePaneTabLayout(
                kind,
                state.Key,
                state.Session?.Id,
                state.WorkingDirectory,
                state.TitleBlock.Text ?? state.Key,
                state.LaunchedAt,
                string.IsNullOrWhiteSpace(state.ProviderId) ? null : state.ProviderId);
        }
        var preview = _previewTabs.FirstOrDefault(entry => ReferenceEquals(entry.Value, tab));
        if (!string.IsNullOrWhiteSpace(preview.Key))
        {
            var session = _previewSessionByTab.GetValueOrDefault(tab);
            if (session is null) return null;
            return new NativePaneTabLayout(
                "preview", preview.Key, session.Id, session.WorkingDir,
                session.DisplayTitle, ProviderId: SessionProvider(session));
        }
        return null;
    }

    private string? TabPersistenceKey(TabItem tab)
    {
        if (ReferenceEquals(tab, DashboardTab)) return "dashboard";
        var state = _openTabs.Values.FirstOrDefault(candidate => ReferenceEquals(candidate.Tab, tab));
        if (state is not null) return OpenTabRegistryKey(state);
        var preview = _previewTabs.FirstOrDefault(entry => ReferenceEquals(entry.Value, tab));
        return string.IsNullOrWhiteSpace(preview.Key) ? null : preview.Key;
    }

    private async Task PersistSettingsAsync()
    {
        try
        {
            await _settingsStore.SaveAsync(_settings);
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Settings save failed without interrupting the UI: {ex}");
        }
    }

    private void ApplySidebarState()
    {
        var collapsed = _settings.SidebarCollapsed;
        SidebarBorder.IsVisible = !collapsed;
        CompactSidebarBorder.IsVisible = collapsed;
        SidebarSplitter.IsVisible = !collapsed;
        MainContentGrid.ColumnDefinitions[0].Width = collapsed
            ? new GridLength(52)
            : new GridLength(Math.Clamp(_settings.SidebarWidth, 240, 640));
        MainContentGrid.ColumnDefinitions[1].Width = collapsed ? new GridLength(0) : new GridLength(5);
        ToolTip.SetTip(SidebarToggleButton, collapsed ? "Expand session sidebar" : "Use compact session rail");
    }

    private void ApplyResponsiveDashboardLayout(double width)
    {
        ReflowGrid(HealthGrid, width >= 560 ? 2 : 1);
        ReflowGrid(UsageGrid, width >= 820 ? 3 : width >= 560 ? 2 : 1);
        ReflowGrid(ActivityToolsGrid, width >= 620 ? 2 : 1);
        ReflowGrid(LeaderboardsGrid, width >= 820 ? 3 : width >= 560 ? 2 : 1);
        ReflowGrid(StatsSummaryGrid, width >= 620 ? 2 : 1);
    }

    private static void ReflowGrid(Grid grid, int columns)
    {
        columns = Math.Max(1, columns);
        var rows = Math.Max(1, (int)Math.Ceiling(grid.Children.Count / (double)columns));
        if (grid.ColumnDefinitions.Count == columns
            && grid.RowDefinitions.Count == rows
            && grid.Children.Select((child, index) =>
                Grid.GetColumn(child) == index % columns && Grid.GetRow(child) == index / columns).All(matches => matches))
            return;
        grid.ColumnDefinitions.Clear();
        for (var column = 0; column < columns; column++)
            grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
        grid.RowDefinitions.Clear();
        for (var row = 0; row < rows; row++)
            grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        for (var index = 0; index < grid.Children.Count; index++)
        {
            Grid.SetColumn(grid.Children[index], index % columns);
            Grid.SetRow(grid.Children[index], index / columns);
        }
    }

    private void RenderStats(DashboardStats stats)
    {
        var rollup = SelectedUsageRollup(stats);
        var totals = rollup?.Totals ?? new UsageTotals();
        var window = _settings.AnalyticsWindow;
        stats.TokensByHour.TryGetValue(window, out var tokenWindow);
        var activityTokens = (tokenWindow?.Input.Sum() ?? 0) + (tokenWindow?.Output.Sum() ?? 0);
        var totalTokens = rollup is null ? activityTokens : totals.TotalTokens;
        var creditSummary = rollup is null ? "credit estimate unavailable" : CreditEstimate(totals);
        var providerSummary = _api.ProviderId == "codex"
            ? $"{CohortLabel(stats.StatsFilters.StatsMode)} cohort"
            : $"{CurrentProviderLabel} provider";
        StatsSummaryText.Text =
            $"{rollup?.Label ?? SelectedWindowLabel()}: {FormatNumber(totalTokens)} tokens   ·   " +
            $"{creditSummary}   ·   {stats.Activity.H24:N0} active in 24h   ·   " +
            $"{stats.TotalSubagents:N0} subagents   ·   {providerSummary}";
        StatsCohortPanel.IsVisible = stats.StatsFilters.TranscriptHeadlessCount > 0;

        RenderUsageSummary(rollup, stats.Pricing);

        PopulateMetricRows(
            ProjectsPanel,
            (rollup?.Projects ?? []).Take(8)
                .Select(project => (project.Name, project.TotalTokens,
                    $"{FormatNumber(project.TotalTokens)} tokens · {CreditEstimate(project)}")),
            "No token_count telemetry for projects in this window.");
        ProjectComboGraph.MessagesBrush = Brush.Parse("#38BDF8");
        ProjectComboGraph.DurationBrush = StartingBrush;
        ProjectComboGraph.SessionsBrush = ResourceBrush("AccentBrush");
        ProjectComboGraph.GridBrush = ResourceBrush("BorderBrush");
        ProjectComboGraph.SetData(stats.Projects.OrderByDescending(project => project.Messages).Take(10).ToList());
        if (rollup is not null)
        {
            PopulateModelRows(rollup.Models.Take(10));
        }
        else
        {
            PopulateMetricRows(
                ModelsPanel,
                stats.Models.Take(10).Select(model =>
                {
                    var total = model.TotalTokens > 0
                        ? model.TotalTokens
                        : model.InputTokens + model.OutputTokens + model.CacheReadTokens + model.CacheWriteTokens;
                    return (model.Model, total, $"{FormatNumber(total)} tokens · {model.Calls:N0} calls");
                }),
                $"No {CurrentProviderLabel} model token telemetry is available.");
        }
        PopulateMetricRows(
            ToolsPanel,
            stats.Tools.Interactive.OrderByDescending(tool => tool.Calls).Take(12)
                .Select(tool => (tool.Name, tool.Calls, $"{tool.Calls:N0} calls")));
        PopulateLines(
            HeadlessToolsPanel,
            stats.Tools.Headless.OrderByDescending(tool => tool.Calls).Take(12)
                .Select(tool => $"{tool.Name}   {tool.Calls:N0} calls"));
        PopulateLines(
            ActivityPanel,
            new[]
            {
                $"Last 24 hours   {stats.Activity.H24:N0}",
                $"24–48 hours   {stats.Activity.H48:N0}",
                $"48–72 hours   {stats.Activity.H72:N0}",
                $"Older   {stats.Activity.Older:N0}",
                $"All sessions   {stats.Activity.Total:N0}",
            });

        EnvironmentPanel.Children.Clear();
        AddEnvironmentChips("MCP", stats.McpServers);
        AddEnvironmentChips("SKILL", stats.Skills);
        AddEnvironmentChips("PLUGIN", stats.Plugins);
        EnvSummaryText.Text = $"MCP {stats.McpServers.Count}  ·  skills {stats.Skills.Count}  ·  plugins {stats.Plugins.Count}";
        _rateLimits = stats.RateLimits;
        RenderRateLimits(_rateLimits);

        TokenActivityGraph.InputBrush = Brush.Parse("#38BDF8");
        TokenActivityGraph.OutputBrush = ResourceBrush("AccentBrush");
        TokenActivityGraph.GridBrush = ResourceBrush("BorderBrush");
        TokenActivityGraph.SetData(tokenWindow?.Input, tokenWindow?.Output);
        TokenActivityDescriptionText.Text =
            $"{rollup?.Label ?? window} · input and output aggregated by local clock hour · weekday/hour intensity below";
        if (ResourceBrush("AccentBrush") is SolidColorBrush accent) TokenHeatmapGraph.AccentColor = accent.Color;
        TokenHeatmapGraph.EmptyBrush = ResourceBrush("ElevatedBrush");
        TokenHeatmapGraph.SetData(stats.TokenHeatmap
            .Select(row => (IReadOnlyList<long>)row.Select(cell =>
                cell.Windows.TryGetValue(window, out var value) ? value : 0).ToList())
            .ToList());

        PopulateLeaderboard(DurationLeadersPanel, stats.TopSessionsByDuration, entry => entry.DurationSec, entry => entry.DurationStr);
        PopulateLeaderboard(MessageLeadersPanel, stats.TopSessionsByUserMsgs, entry => entry.UserMsgCount, entry => $"{entry.UserMsgCount:N0} messages");
        if (rollup is not null)
            PopulateTokenLeaderboard(rollup.Sessions.Take(10));
        else
            PopulateLeaderboard(
                TokenLeadersPanel,
                stats.TopSessionsByTokens,
                entry => entry.TotalTokens,
                entry => $"{FormatNumber(entry.TotalTokens)} tokens");
    }

    private UsageRollup? SelectedUsageRollup(DashboardStats stats)
    {
        if (stats.UsageRollups.TryGetValue(_settings.AnalyticsWindow, out var selected)) return selected;
        return null;
    }

    private void RenderUsageSummary(UsageRollup? rollup, PricingMetadata pricing)
    {
        if (rollup is null)
        {
            var isCodex = _api.ProviderId == "codex";
            UsageWindowDescriptionText.Text = isCodex
                ? $"Usage data unavailable for {_settings.AnalyticsWindow}; dashboard API v{DashboardApiClient.RequiredApiVersion} is required"
                : $"{CurrentProviderLabel} exposes token activity without Codex credit rollups.";
            UsageSummaryPanel.Children.Clear();
            AddEmptyState(
                UsageSummaryPanel,
                isCodex
                    ? "The connected service returned an incomplete analytics payload."
                    : $"Use the activity, model, project, and leaderboard panels for {CurrentProviderLabel} analytics.");
            UsagePricingNoteText.Text = isCodex
                ? "Restart ui-my-cli with the current code before evaluating token or credit data."
                : $"Credit estimates are unavailable because {CurrentProviderLabel} does not expose the Codex pricing telemetry contract.";
            return;
        }
        var totals = rollup.Totals;
        UsageWindowDescriptionText.Text =
            $"{rollup.Label} · exact local telemetry where Codex reports token_count events";
        UsageSummaryPanel.Children.Clear();
        AddUsageSummaryMetric("FRESH INPUT", FormatNumber(totals.InputTokens), "full input rate");
        AddUsageSummaryMetric("CACHED INPUT", FormatNumber(totals.CachedInputTokens), "discounted input rate");
        AddUsageSummaryMetric("TOTAL INPUT", FormatNumber(totals.TotalInputTokens), "fresh + cached");
        AddUsageSummaryMetric("TOTAL OUTPUT", FormatNumber(totals.OutputTokens), "includes reasoning");
        AddUsageSummaryMetric("REASONING", FormatNumber(totals.ReasoningOutputTokens), "part of output; no multiplier");
        AddUsageSummaryMetric("TOTAL TOKENS", FormatNumber(totals.TotalTokens), $"{totals.Calls:N0} model calls");
        AddUsageSummaryMetric("EST. CREDITS", CreditValue(totals), PricingCoverageLabel(totals));

        var sourceVersion = string.IsNullOrWhiteSpace(pricing.Version) ? "published rate card" : $"rate card {pricing.Version}";
        UsagePricingNoteText.Text = totals.UnpricedTokens > 0
            ? $"Credit estimate is partial: {FormatNumber(totals.UnpricedTokens)} tokens use models absent from the public {sourceVersion}. " +
              "Reasoning tokens are already included in output tokens and use the output rate; reasoning effort has no separate published multiplier. " +
              "Estimate assumes Standard mode because stored telemetry does not identify Fast mode."
            : $"Credit estimate uses the Codex {sourceVersion}. Reasoning tokens are already included in output tokens and use the output rate; " +
              "reasoning effort has no separate published multiplier. Estimate assumes Standard mode because stored telemetry does not identify Fast mode.";
        ToolTip.SetTip(UsagePricingNoteText, pricing.Source);
    }

    private void AddUsageSummaryMetric(string label, string value, string detail)
    {
        UsageSummaryPanel.Children.Add(new Border
        {
            Width = 155,
            MinHeight = 76,
            Margin = new Thickness(0, 0, 8, 8),
            Padding = new Thickness(10, 8),
            Background = ResourceBrush("SurfaceBrush"),
            BorderBrush = ResourceBrush("BorderBrightBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Child = new StackPanel
            {
                Spacing = 2,
                Children =
                {
                    new TextBlock { Text = value, FontSize = 19, FontWeight = FontWeight.Bold, Foreground = ResourceBrush("PrimaryBrush") },
                    new TextBlock { Text = label, FontSize = 9, FontWeight = FontWeight.Bold, Foreground = ResourceBrush("AccentBrush") },
                    new TextBlock { Text = detail, FontSize = 9, Foreground = ResourceBrush("MutedBrush"), TextWrapping = TextWrapping.Wrap },
                },
            },
        });
    }

    private void RenderLatestPrompt()
    {
        var latest = _sessions
            .Where(session => !string.IsNullOrWhiteSpace(session.LastUserPrompt))
            .OrderByDescending(session => session.LastActivityAt)
            .FirstOrDefault();
        LatestPromptButton.IsVisible = latest is not null;
        LatestPromptButton.Tag = latest;
        if (latest is null) return;
        LatestPromptText.Text = latest.LastUserPrompt.Replace('\n', ' ').Replace('\r', ' ').Trim();
        LatestPromptMetaText.Text = $"{latest.DisplayTitle} · {latest.Project} · {latest.LastActivityAgo}";
        ToolTip.SetTip(LatestPromptButton, latest.LastUserPrompt);
    }

    private static string CohortLabel(string mode) => mode switch
    {
        "triage" => "triage",
        "codex" => "native Codex",
        _ => "combined",
    };

    private void PopulateMetricRows(
        Panel panel,
        IEnumerable<(string Label, long Value, string Detail)> rows,
        string? emptyMessage = null)
    {
        panel.Children.Clear();
        var materialized = rows.ToList();
        if (materialized.Count == 0 && !string.IsNullOrWhiteSpace(emptyMessage))
        {
            AddEmptyState(panel, emptyMessage);
            return;
        }
        var maximum = Math.Max(1, materialized.Select(row => row.Value).DefaultIfEmpty().Max());
        foreach (var row in materialized)
        {
            var header = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
            header.Children.Add(new TextBlock
            {
                Text = row.Label,
                Foreground = ResourceBrush("PrimaryBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            var detail = new TextBlock { Text = row.Detail, Foreground = ResourceBrush("SecondaryBrush"), FontSize = 10 };
            header.Children.Add(detail);
            Grid.SetColumn(detail, 1);
            panel.Children.Add(new StackPanel
            {
                Spacing = 2,
                Children =
                {
                    header,
                    new ProgressBar { Minimum = 0, Maximum = maximum, Value = row.Value, Height = 5 },
                },
            });
        }
    }

    private void PopulateModelRows(IEnumerable<UsageBreakdown> models)
    {
        ModelsPanel.Children.Clear();
        var rows = models.ToList();
        if (rows.Count == 0)
        {
            AddEmptyState(ModelsPanel, $"No model token_count telemetry in {SelectedWindowLabel()}.");
            return;
        }
        foreach (var model in rows)
        {
            var bar = new StackedTokenBar { Height = 7 };
            bar.SegmentBrushes = TokenCategoryBrushes();
            AutomationProperties.SetName(bar, $"Token composition for {model.Model}, reasoning {model.ReasoningEffort}");
            var values = TokenCategoryValues(
                model.VisibleOutputTokens,
                model.ReasoningOutputTokens,
                model.InputTokens,
                model.CachedInputTokens,
                0,
                model.UnclassifiedTokens);
            bar.SetData(values);
            var visibleTotal = values.Sum();
            ModelsPanel.Children.Add(new StackPanel
            {
                Spacing = 2,
                Children =
                {
                    new TextBlock
                    {
                        Text = $"{model.Model} · {model.ReasoningEffort}",
                        Foreground = ResourceBrush("PrimaryBrush"),
                        TextTrimming = TextTrimming.CharacterEllipsis,
                    },
                    bar,
                    new TextBlock
                    {
                        Text = $"{FormatNumber(visibleTotal)} visible · {FormatNumber(model.TotalTokens)} total · {CreditEstimate(model)} · {model.Calls:N0} calls",
                        Foreground = ResourceBrush("SecondaryBrush"),
                        FontSize = 10,
                    },
                },
            });
        }
    }

    private long[] TokenCategoryValues(
        long output,
        long reasoning,
        long input,
        long cached,
        long cacheWrite,
        long unclassified) =>
    [
        _hiddenTokenCategories.Contains("output") ? 0 : output,
        _hiddenTokenCategories.Contains("reasoning") ? 0 : reasoning,
        _hiddenTokenCategories.Contains("input") ? 0 : input,
        _hiddenTokenCategories.Contains("cached") ? 0 : cached,
        _hiddenTokenCategories.Contains("cache-write") ? 0 : cacheWrite,
        _hiddenTokenCategories.Contains("unclassified") ? 0 : unclassified,
    ];

    private IReadOnlyList<IBrush> TokenCategoryBrushes() =>
    [
        ResourceBrush("AccentBrush"), Brush.Parse("#FF8A4C"), Brush.Parse("#38BDF8"),
        Brush.Parse("#8B5CF6"), Brush.Parse("#EAB308"), ResourceBrush("MutedBrush"),
    ];

    private void PopulateTokenLeaderboard(IEnumerable<UsageBreakdown> entries)
    {
        TokenLeadersPanel.Children.Clear();
        var rows = entries.Take(10).ToList();
        if (rows.Count == 0)
        {
            AddEmptyState(TokenLeadersPanel, $"No session token_count telemetry in {SelectedWindowLabel()}.");
            return;
        }
        foreach (var entry in rows)
        {
            var values = TokenCategoryValues(
                entry.VisibleOutputTokens,
                entry.ReasoningOutputTokens,
                entry.InputTokens,
                entry.CachedInputTokens,
                0,
                entry.UnclassifiedTokens);
            var bar = new StackedTokenBar { Height = 7 };
            bar.SegmentBrushes = TokenCategoryBrushes();
            AutomationProperties.SetName(bar, $"Token composition for {entry.Title}");
            bar.SetData(values);
            var visibleTotal = values.Sum();
            var button = new Button
            {
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(2, 3),
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                Content = new StackPanel
                {
                    Spacing = 3,
                    Children =
                    {
                        new Grid
                        {
                            ColumnDefinitions = new ColumnDefinitions("*,Auto"),
                            Children =
                            {
                                new TextBlock { Text = entry.Title, Foreground = ResourceBrush("PrimaryBrush"), TextTrimming = TextTrimming.CharacterEllipsis },
                                LeaderValue($"{FormatNumber(visibleTotal)} · {CreditEstimate(entry)}"),
                            },
                        },
                        bar,
                        new TextBlock { Text = $"{entry.Project} · {entry.Model} · {entry.ReasoningEffort}", Foreground = ResourceBrush("MutedBrush"), FontSize = 9 },
                    },
                },
            };
            var header = (Grid)((StackPanel)button.Content).Children[0];
            Grid.SetColumn(header.Children[1], 1);
            ToolTip.SetTip(button, entry.Title);
            button.Click += async (_, _) =>
            {
                var session = _sessions.Concat(_archivedSessions).FirstOrDefault(candidate => candidate.Id == entry.Id)
                    ?? new DashboardSession { Id = entry.Id, Title = entry.Title, Project = entry.Project, Model = entry.Model, ReasoningEffort = entry.ReasoningEffort };
                await OpenPreviewAsync(session);
            };
            TokenLeadersPanel.Children.Add(button);
        }
    }

    private string SelectedWindowLabel() => _settings.AnalyticsWindow switch
    {
        "1d" => "the last 24 hours",
        "2d" => "the last 48 hours",
        "7d" => "the last 7 days",
        "14d" => "the last 14 days",
        "30d" => "the last 30 days",
        "all" => "all recorded time",
        _ => "the selected window",
    };

    private void AddEmptyState(Panel panel, string text) => panel.Children.Add(new TextBlock
    {
        Text = text,
        Foreground = ResourceBrush("SecondaryBrush"),
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(2, 8),
    });

    private void OnProjectSeriesToggled(object? sender, RoutedEventArgs e)
    {
        if (!_uiReady) return;
        ProjectComboGraph.ShowMessages = ProjectMessagesToggle.IsChecked == true;
        ProjectComboGraph.ShowDuration = ProjectDurationToggle.IsChecked == true;
        ProjectComboGraph.ShowSessions = ProjectSessionsToggle.IsChecked == true;
        ProjectComboGraph.InvalidateVisual();
    }

    private void OnModelTokenCategoryToggled(object? sender, RoutedEventArgs e)
    {
        if (!_uiReady || sender is not ToggleButton { Tag: string category } toggle) return;
        if (toggle.IsChecked == true) _hiddenTokenCategories.Remove(category);
        else _hiddenTokenCategories.Add(category);
        if (_stats is null) return;
        var rollup = SelectedUsageRollup(_stats);
        if (rollup is not null)
        {
            PopulateModelRows(rollup.Models.Take(10));
            PopulateTokenLeaderboard(rollup.Sessions.Take(10));
        }
    }

    private void PopulateLeaderboard(
        Panel panel,
        IEnumerable<SessionRanking> entries,
        Func<SessionRanking, long> value,
        Func<SessionRanking, string> display)
    {
        panel.Children.Clear();
        var rows = entries.Take(10).ToList();
        var maximum = Math.Max(1, rows.Select(value).DefaultIfEmpty().Max());
        foreach (var entry in rows)
        {
            var button = new Button
            {
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(2, 3),
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                Content = new StackPanel
                {
                    Spacing = 2,
                    Children =
                    {
                        new Grid
                        {
                            ColumnDefinitions = new ColumnDefinitions("*,Auto"),
                            Children =
                            {
                                new TextBlock { Text = entry.Title, Foreground = ResourceBrush("PrimaryBrush"), TextTrimming = TextTrimming.CharacterEllipsis },
                                LeaderValue(display(entry)),
                            },
                        },
                        new ProgressBar { Minimum = 0, Maximum = maximum, Value = value(entry), Height = 4 },
                        new TextBlock { Text = $"{entry.Project} · {entry.Model} · {entry.ReasoningEffort}", Foreground = ResourceBrush("MutedBrush"), FontSize = 9 },
                    },
                },
            };
            ToolTip.SetTip(button, entry.Title);
            var valueText = ((Grid)((StackPanel)button.Content).Children[0]).Children[1];
            Grid.SetColumn(valueText, 1);
            button.Click += async (_, _) =>
            {
                var session = _sessions.Concat(_archivedSessions).FirstOrDefault(candidate => candidate.Id == entry.Id)
                    ?? new DashboardSession { Id = entry.Id, Title = entry.Title, Project = entry.Project, Model = entry.Model, ReasoningEffort = entry.ReasoningEffort };
                await OpenPreviewAsync(session);
            };
            panel.Children.Add(button);
        }
    }

    private TextBlock LeaderValue(string text) => new()
    {
        Text = text,
        Foreground = ResourceBrush("AccentBrush"),
        FontSize = 10,
        Margin = new Thickness(8, 0, 0, 0),
    };

    private void RenderProviderStatus(DashboardStatus status)
    {
        var provider = status.Providers.FirstOrDefault(candidate => candidate.Id == _api.ProviderId);
        ProviderHealthBar.Value = provider?.Available == true ? 100 : 0;
        var summary = provider is null
            ? $"{CurrentProviderLabel} provider not reported · {status.ActivePtys:N0} persistent terminals"
            : $"{(provider.Available ? "Available" : "Unavailable")} · {provider.Version ?? "version unknown"} · " +
              $"{status.ActivePtys:N0} persistent terminal{(status.ActivePtys == 1 ? string.Empty : "s")} · " +
              $"service up {FormatDuration(status.Uptime)}";
        var error = provider?.Available == false && !string.IsNullOrWhiteSpace(provider.Error)
            ? provider.Error.Trim()
            : null;
        ProviderStatusText.Text = error is null ? summary : $"{summary}\n{error}";
        ToolTip.SetTip(ProviderStatusText, error);
    }

    private void RenderRateLimits(RateLimitInfo? rateLimits)
    {
        if (rateLimits is null)
        {
            RateLimitText.Text = $"{CurrentProviderLabel} has not emitted rate-limit telemetry for the latest session.";
            RateLimitBar.Value = 0;
            return;
        }
        var active = rateLimits.Primary ?? rateLimits.Secondary;
        RateLimitBar.Value = Math.Clamp(active?.UsedPercent ?? 0, 0, 100);
        var windows = new List<string>();
        if (rateLimits.Primary is not null) windows.Add(RateWindowText("primary", rateLimits.Primary));
        if (rateLimits.Secondary is not null) windows.Add(RateWindowText("secondary", rateLimits.Secondary));
        var credit = rateLimits.Credits?.Unlimited == true
            ? "credits unlimited"
            : rateLimits.Credits?.Balance is double balance
                ? $"{balance:N2} credits"
                : rateLimits.Credits?.HasCredits == true ? "credits available" : "credits not reported";
        RateLimitText.Text = $"{rateLimits.PlanType ?? "unknown"} plan · {credit}" +
            (windows.Count > 0 ? $"\n{string.Join(" · ", windows)}" : " · no active limit window") +
            (string.IsNullOrWhiteSpace(rateLimits.ReachedType) ? string.Empty : $"\nLimit reached: {rateLimits.ReachedType}");
    }

    private static string RateWindowText(string label, RateLimitWindow window)
    {
        var reset = window.ResetsAt > 0
            ? DateTimeOffset.FromUnixTimeSeconds(window.ResetsAt).ToLocalTime().ToString("MMM d HH:mm")
            : "unknown";
        return $"{label} {window.UsedPercent:0.#}% / {window.WindowMinutes:N0}m · resets {reset}";
    }

    private void PopulateLines(Panel panel, IEnumerable<string> lines)
    {
        panel.Children.Clear();
        foreach (var line in lines)
        {
            panel.Children.Add(new TextBlock
            {
                Text = line,
                Foreground = ResourceBrush("SecondaryBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }
    }

    private void AddEnvironmentChips(string prefix, IEnumerable<NamedEnvironmentItem> items)
    {
        foreach (var item in items)
        {
            var chip = new Border
            {
                Background = ResourceBrush("ElevatedBrush"),
                BorderBrush = ResourceBrush("BorderBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8, 4),
                Margin = new Thickness(0, 0, 7, 7),
                Child = new TextBlock
                {
                    Text = $"{prefix}  {item.Name}",
                    Foreground = ResourceBrush(prefix == "SKILL" ? "AccentBrush" : "SecondaryBrush"),
                    FontSize = 11,
                },
            };
            ToolTip.SetTip(chip, item.Description ?? item.Url ?? item.Dir ?? item.Type ?? item.Name);
            EnvironmentPanel.Children.Add(chip);
        }
    }

    private async Task OpenSessionAsync(
        DashboardSession session,
        bool activate = true,
        bool launch = true,
        TerminalPaneState? targetPane = null)
    {
        targetPane ??= _activePane;
        if (session.IsHeadless || session.Archived)
        {
            await OpenPreviewAsync(session, targetPane);
            return;
        }
        var providerId = SessionProvider(session);
        session.Provider = providerId;
        if (_openTabs.TryGetValue(ProviderTabKey(providerId, session.Id), out var existing))
        {
            if (!ReferenceEquals(existing.Pane, targetPane)) await MoveTabToPaneAsync(existing, targetPane);
            AttachTab(existing, activate);
            if (launch) await EnsureTerminalLaunchedAsync(existing);
            return;
        }

        var state = CreateTerminalTab(
            session.Id, session.DisplayTitle, session.WorkingDir, session, TerminalSessionKind.Codex, targetPane);
        _openTabs.Add(OpenTabRegistryKey(state), state);
        AddTabToPane(targetPane, state.Tab);
        state.IsAttached = true;
        if (activate)
        {
            targetPane.Tabs.SelectedItem = state.Tab;
            SetActivePane(targetPane);
        }
        if (launch)
        {
            await EnsureTerminalLaunchedAsync(state);
        }
        _ = LoadSessionDetailsAsync(state, session);
        UpdatePaneEmptyStates();
        await SaveWorkspaceAsync();
    }

    private async Task OpenNewSessionAsync(string workingDirectory, TerminalPaneState? targetPane = null)
    {
        targetPane ??= _activePane;
        try
        {
            var key = await _api.CreateSessionAsync(workingDirectory, targetPane.AdaptiveEnabled);
            var project = workingDirectory.TrimEnd('/').Split('/').LastOrDefault() ?? workingDirectory;
            var state = CreateTerminalTab(
                key, $"New · {project}", workingDirectory, null, TerminalSessionKind.Codex, targetPane);
            state.KnownSessionIdsAtLaunch = _sessions.Select(session => session.Id).ToHashSet(StringComparer.Ordinal);
            state.LaunchedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            _openTabs.Add(OpenTabRegistryKey(state), state);
            AddTabToPane(targetPane, state.Tab);
            state.IsAttached = true;
            UpdatePaneAdaptiveControls(targetPane);
            targetPane.Tabs.SelectedItem = state.Tab;
            SetActivePane(targetPane);
            await LaunchTerminalAsync(state);
            UpdatePaneEmptyStates();
            await SaveWorkspaceAsync();
        }
        catch (Exception ex)
        {
            SetStatus($"New session failed: {ex.Message}", ErrorBrush);
        }
    }

    private async Task OpenLocalShellSessionAsync(
        string workingDirectory,
        TerminalPaneState? targetPane = null,
        bool activate = true,
        bool launch = true,
        string? restoredKey = null,
        string? restoredTitle = null)
    {
        targetPane ??= _activePane;
        try
        {
            var key = restoredKey ?? $"shell:{Guid.NewGuid():N}";
            var project = workingDirectory.TrimEnd('/').Split('/').LastOrDefault() ?? workingDirectory;
            var title = restoredTitle ?? $"{_platform.LocalShellLabel} · {project}";
            var state = CreateTerminalTab(
                key, title, workingDirectory, null, TerminalSessionKind.LocalShell, targetPane);
            _openTabs.Add(OpenTabRegistryKey(state), state);
            AddTabToPane(targetPane, state.Tab);
            state.IsAttached = true;
            if (activate)
            {
                targetPane.Tabs.SelectedItem = state.Tab;
                SetActivePane(targetPane);
            }
            if (launch) await EnsureTerminalLaunchedAsync(state);
            UpdatePaneEmptyStates();
            await SaveWorkspaceAsync();
        }
        catch (Exception ex)
        {
            SetStatus($"{_platform.LocalShellLabel} session failed: {ex.Message}", ErrorBrush);
        }
    }

    private SessionTabState CreateTerminalTab(
        string key,
        string title,
        string workingDirectory,
        DashboardSession? session,
        TerminalSessionKind kind,
        TerminalPaneState pane,
        string? providerId = null)
    {
        var isLocalShell = kind == TerminalSessionKind.LocalShell;
        providerId = isLocalShell
            ? string.Empty
            : string.IsNullOrWhiteSpace(providerId)
                ? session is null ? _api.ProviderId : SessionProvider(session)
                : providerId;
        var providerLabel = ProviderLabel(providerId);
        var textSize = DashboardTextSize.Find(_settings.TextSizeId);
        var tabFontSize = TabHeaderFontSize(textSize);
        var terminal = new TerminalControl
        {
            Process = string.Empty,
            BufferSize = 10000,
            MinHeight = 0,
            FontFamily = new FontFamily("Cascadia Mono, Consolas"),
            FontSize = textSize.TerminalFontSize,
            Background = ResourceBrush("TerminalBrush"),
            Foreground = ResourceBrush("PrimaryBrush"),
        };
        terminal.AddHandler(
            InputElement.KeyDownEvent,
            OnTerminalPasteKeyDown,
            RoutingStrategies.Tunnel,
            handledEventsToo: true);
        terminal.AddHandler(
            InputElement.PointerWheelChangedEvent,
            OnTerminalPointerWheelChanged,
            RoutingStrategies.Tunnel,
            handledEventsToo: true);
        var reconnectText = new TextBlock
        {
            Text = "Terminal connection lost · reconnecting…",
            Foreground = ResourceBrush("PrimaryBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        var reconnectButton = new Button
        {
            Content = "Retry now",
            Padding = new Thickness(10, 4),
        };
        var reconnectBanner = new Border
        {
            IsVisible = false,
            Background = ResourceBrush("ElevatedBrush"),
            BorderBrush = ResourceBrush("BorderBrightBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(10, 7),
            Margin = new Thickness(12),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
            Child = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 10,
                Children = { reconnectText, reconnectButton },
            },
        };
        AutomationProperties.SetName(reconnectBanner, "Terminal connection status");
        AutomationProperties.SetLiveSetting(reconnectBanner, AutomationLiveSetting.Polite);

        var restoreText = new TextBlock
        {
            Text = "Restoring conversation…",
            Foreground = ResourceBrush("PrimaryBrush"),
            FontSize = 13,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        var restoreOverlay = new Border
        {
            IsVisible = false,
            Background = ResourceBrush("TerminalBrush"),
            BorderBrush = ResourceBrush("BorderBrightBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(7),
            Padding = new Thickness(20, 16),
            Margin = new Thickness(18),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new StackPanel
            {
                Width = 250,
                Spacing = 10,
                Children =
                {
                    restoreText,
                    new ProgressBar { IsIndeterminate = true, Height = 5 },
                },
            },
        };
        AutomationProperties.SetName(restoreOverlay, $"Restoring {providerLabel} conversation");
        AutomationProperties.SetLiveSetting(restoreOverlay, AutomationLiveSetting.Polite);

        var contextText = MakeDetailText(isLocalShell
            ? $"Interactive login shell on {_platform.DisplayName}."
            : "Context data will load after the terminal opens.");
        var contextBar = new ProgressBar { Minimum = 0, Maximum = 100, Height = 6, Margin = new Thickness(0, 3, 0, 4) };
        var contextDonut = new ContextDonutControl
        {
            Width = 70,
            Height = 70,
            Margin = new Thickness(0, 2, 6, 0),
            SegmentBrushes =
            [
                Brush.Parse("#38BDF8"), Brush.Parse("#8B5CF6"), ResourceBrush("AccentBrush"),
                StartingBrush, ErrorBrush, Brush.Parse("#334155")
            ],
        };
        contextBar.IsVisible = !isLocalShell;
        contextDonut.IsVisible = !isLocalShell;
        var configText = MakeDetailText(isLocalShell
            ? workingDirectory
            : session is null ? $"New session configuration is managed by {providerLabel}." : "Loading model, permissions, rules, and skills…");
        var promptText = MakeDetailText(isLocalShell
            ? "Run shell commands directly. Type exit or close the tab to end this shell."
            : session?.LastUserPrompt ?? "The terminal is ready for a new prompt.");

        var detailsGrid = new Grid { ColumnDefinitions = new ColumnDefinitions("1.1*,1*,1.4*"), ColumnSpacing = 10 };
        var contextColumn = ContextDetailColumn(contextDonut, contextBar, contextText, 0);
        var configColumn = DetailColumn("CONFIGURATION", null, configText, 1);
        var promptColumn = DetailColumn("LATEST PROMPT", null, promptText, 2);
        detailsGrid.Children.Add(contextColumn);
        detailsGrid.Children.Add(configColumn);
        detailsGrid.Children.Add(promptColumn);
        var detailHeadings = new[]
        {
            (TextBlock)contextColumn.Children[0],
            (TextBlock)configColumn.Children[0],
            (TextBlock)promptColumn.Children[0],
        };
        if (isLocalShell)
        {
            detailHeadings[0].Text = "SHELL";
            detailHeadings[1].Text = "WORKING DIRECTORY";
            detailHeadings[2].Text = "LIFECYCLE";
        }

        var renameBox = new TextBox { Text = title, MinWidth = 160, Width = 230, PlaceholderText = "Session title" };
        var renameButton = new Button { Content = "Rename", Padding = new Thickness(8, 3) };
        var archiveButton = new Button { Content = "Archive", Padding = new Thickness(8, 3), IsVisible = session is not null };
        var summaryButton = new Button { Content = "Summary", Padding = new Thickness(8, 3), IsVisible = session is not null };
        var stopButton = new Button { Content = "Stop", Padding = new Thickness(8, 3) };
        ToolTip.SetTip(stopButton, isLocalShell
            ? $"Stop the {_platform.LocalShellLabel} and remove this tab"
            : $"Stop the {providerLabel} process and remove this tab");
        var actions = new WrapPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        var actionControls = new Control[] { renameBox, summaryButton, renameButton, archiveButton, stopButton };
        foreach (var action in actionControls)
        {
            action.Margin = new Thickness(0, 0, 4, 4);
            actions.Children.Add(action);
        }

        var inspectorToggleButton = new Button
        {
            Content = pane.InspectorCollapsed ? "Expand" : "Collapse",
            Padding = new Thickness(8, 2),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ToolTip.SetTip(inspectorToggleButton, "Collapse or expand session context");
        AutomationProperties.SetName(inspectorToggleButton, "Collapse session context");
        var inspectorHeading = new TextBlock
        {
            Text = "SESSION CONTEXT",
            Foreground = ResourceBrush("SecondaryBrush"),
            FontWeight = FontWeight.Bold,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var inspectorHeader = new Grid
        {
            ColumnDefinitions = new ColumnDefinitions("*,Auto"),
            Children =
            {
                inspectorHeading,
                inspectorToggleButton,
            },
        };
        Grid.SetColumn(inspectorToggleButton, 1);
        var inspectorBodyLayout = new Grid
        {
            RowDefinitions = new RowDefinitions("Auto,Auto"),
            RowSpacing = 5,
            Children = { detailsGrid, actions },
        };
        var inspectorBody = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = inspectorBodyLayout,
        };
        Grid.SetRow(actions, 1);
        Grid.SetRow(inspectorBody, 1);
        var inspectorContent = new Grid
        {
            RowDefinitions = new RowDefinitions("Auto,*"),
            RowSpacing = 4,
            Children = { inspectorHeader, inspectorBody },
        };

        var inspector = new Border
        {
            MinHeight = pane.InspectorCollapsed ? InspectorCollapsedHeight : InspectorMinimumHeight,
            MaxHeight = InspectorMaximumHeight,
            Background = ResourceBrush("SurfaceBrush"),
            BorderBrush = ResourceBrush("BorderBrush"),
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(10, pane.InspectorCollapsed ? 4 : 6),
            Child = inspectorContent,
        };
        inspectorBody.IsVisible = !pane.InspectorCollapsed;
        void ReflowInspectorContent(Size size)
        {
            if (pane.InspectorCollapsed) return;
            var bodyHeight = Math.Max(0, size.Height - inspectorHeader.Bounds.Height - 20);
            var tight = bodyHeight < 105;
            var compact = bodyHeight < 170;
            var columns = size.Width >= 720 || bodyHeight < 145
                ? 3
                : size.Width >= 560 ? 2 : 1;

            ReflowGrid(detailsGrid, columns);
            detailsGrid.ColumnSpacing = tight ? 4 : compact ? 7 : 10;
            detailsGrid.RowSpacing = tight ? 2 : compact ? 4 : 6;
            inspectorBodyLayout.RowSpacing = tight ? 2 : compact ? 3 : 5;
            inspectorContent.RowSpacing = tight ? 1 : compact ? 2 : 4;
            inspector.Padding = new Thickness(
                tight ? 6 : compact ? 8 : 10,
                tight ? 3 : compact ? 4 : 6);

            var donutSize = tight ? 38 : compact ? 52 : 70;
            contextDonut.Width = donutSize;
            contextDonut.Height = donutSize;
            contextDonut.Margin = new Thickness(0, tight ? 0 : 2, tight ? 3 : 6, 0);
            contextBar.Height = tight ? 3 : compact ? 4 : 6;
            contextBar.Margin = new Thickness(0, tight ? 1 : 3, 0, tight ? 2 : 4);
            var maxLines = tight ? 2 : compact ? 3 : 4;
            contextText.MaxLines = maxLines;
            configText.MaxLines = maxLines;
            promptText.MaxLines = maxLines;
            foreach (var column in new[] { contextColumn, configColumn, promptColumn })
                column.Spacing = tight ? 0 : 1;
            foreach (var action in actionControls)
                action.Margin = new Thickness(0, 0, tight ? 3 : 4, tight ? 2 : 4);
            renameBox.Width = tight ? 160 : compact ? 190 : 230;
            inspectorToggleButton.Padding = new Thickness(tight ? 6 : 8, tight ? 1 : 2);
        }
        inspector.SizeChanged += (_, args) => ReflowInspectorContent(args.NewSize);
        inspector.Loaded += (_, _) => ReflowInspectorContent(inspector.Bounds.Size);

        var inspectorResizeGrip = new Border
        {
            Width = 54,
            Height = 3,
            CornerRadius = new CornerRadius(2),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Background = ResourceBrush("AccentBrush"),
            Opacity = 0.72,
            IsHitTestVisible = false,
        };
        var inspectorResizeTrack = new Border
        {
            Background = ResourceBrush("SurfaceBrush"),
            BorderBrush = ResourceBrush("BorderBrightBrush"),
            BorderThickness = new Thickness(0, 1, 0, 0),
            Child = inspectorResizeGrip,
            IsEnabled = !pane.InspectorCollapsed,
            Cursor = new Cursor(StandardCursorType.SizeNorthSouth),
        };
        var inspectorSplitter = inspectorResizeTrack;
        inspectorSplitter.PointerEntered += (_, _) =>
        {
            inspectorResizeTrack.Background = ResourceBrush("ElevatedBrush");
            inspectorResizeGrip.Opacity = 1;
        };
        inspectorSplitter.PointerExited += (_, _) =>
        {
            inspectorResizeTrack.Background = ResourceBrush("SurfaceBrush");
            inspectorResizeGrip.Opacity = 0.72;
        };
        ToolTip.SetTip(inspectorSplitter, "Drag to resize session details");
        AutomationProperties.SetName(inspectorSplitter, "Resize session details panel");

        var content = new Grid
        {
            RowDefinitions = new RowDefinitions(
                $"*,Auto,12,{(pane.InspectorCollapsed ? InspectorCollapsedHeight : Math.Clamp(pane.InspectorHeight, InspectorMinimumHeight, InspectorMaximumHeight)):0.##}"),
            Background = ResourceBrush("TerminalBrush"),
            MinHeight = 0,
            ClipToBounds = true,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        content.Loaded += (_, _) =>
            content.Height = TerminalTabContentHeight(pane.Tabs.Bounds.Height);
        var terminalClip = new Border
        {
            ClipToBounds = true,
            Background = Brushes.Transparent,
            Child = terminal,
        };
        var screenshotButton = new Button
        {
            Content = "📷",
            Width = 32,
            Height = 28,
            Padding = new Thickness(0),
            FontSize = 15,
            Opacity = 0.82,
            IsVisible = !isLocalShell,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 9, 8),
            Background = ResourceBrush("ElevatedBrush"),
            BorderBrush = ResourceBrush("BorderBrightBrush"),
        };
        ToolTip.SetTip(screenshotButton, "Capture and attach a screenshot");
        AutomationProperties.SetName(screenshotButton, "Capture and attach a screenshot");
        var adaptiveToggleButton = new ToggleButton
        {
            Content = "Adaptive off",
            Padding = new Thickness(9, 3),
            FontSize = 11,
            IsVisible = !isLocalShell,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            Background = ResourceBrush("ElevatedBrush"),
            BorderBrush = ResourceBrush("BorderBrightBrush"),
        };
        adaptiveToggleButton.Classes.Add("adaptive-toggle");
        ToolTip.SetTip(adaptiveToggleButton, "Automatically choose a Codex model and reasoning effort for each native prompt");
        AutomationProperties.SetName(adaptiveToggleButton, "Toggle Adaptive model routing for this terminal pane");
        var adaptivePulseHalo = new Border
        {
            IsVisible = false,
            IsHitTestVisible = false,
            Margin = new Thickness(-3),
            CornerRadius = new CornerRadius(7),
            BorderThickness = new Thickness(2),
            Opacity = 0,
        };
        var adaptiveToggleHost = new Grid
        {
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 8, 9, 0),
            Children = { adaptivePulseHalo, adaptiveToggleButton },
        };
        var adaptivePromptBox = new TextBox
        {
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = 38,
            MaxHeight = 88,
            PlaceholderText = "Ask Codex with Adaptive routing…",
            VerticalContentAlignment = VerticalAlignment.Center,
        };
        var adaptiveSendButton = new Button
        {
            Content = "Route + send",
            Padding = new Thickness(12, 7),
            MinWidth = 98,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        var adaptiveRouteText = new TextBlock
        {
            Text = "Rules-first routing · model classifier only when confidence is low",
            FontSize = 10,
            Foreground = ResourceBrush("SecondaryBrush"),
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxLines = 1,
        };
        var adaptiveComposerLayout = new Grid
        {
            ColumnDefinitions = new ColumnDefinitions("*,Auto"),
            RowDefinitions = new RowDefinitions("Auto,Auto"),
            ColumnSpacing = 8,
            RowSpacing = 4,
            Children = { adaptivePromptBox, adaptiveSendButton, adaptiveRouteText },
        };
        Grid.SetColumn(adaptiveSendButton, 1);
        Grid.SetRow(adaptiveRouteText, 1);
        Grid.SetColumnSpan(adaptiveRouteText, 2);
        var adaptiveComposer = new Border
        {
            IsVisible = false,
            MaxWidth = 900,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Margin = new Thickness(12, 8),
            Padding = new Thickness(9, 8),
            CornerRadius = new CornerRadius(7),
            Background = ResourceBrush("SurfaceBrush"),
            BorderBrush = ResourceBrush("AccentBrush"),
            BorderThickness = new Thickness(1),
            Child = adaptiveComposerLayout,
        };
        AutomationProperties.SetName(adaptiveComposer, "Adaptive Codex prompt composer");
        content.Children.Add(terminalClip);
        content.Children.Add(screenshotButton);
        content.Children.Add(adaptiveToggleHost);
        content.Children.Add(adaptiveComposer);
        content.Children.Add(reconnectBanner);
        content.Children.Add(restoreOverlay);
        content.Children.Add(inspectorResizeTrack);
        content.Children.Add(inspector);
        Grid.SetRow(adaptiveComposer, AdaptiveComposerRow);
        Grid.SetRow(inspectorResizeTrack, InspectorSplitterRow);
        Grid.SetRow(inspector, InspectorRow);
        Grid.SetRow(screenshotButton, 0);
        Grid.SetRow(adaptiveToggleHost, 0);
        terminalClip.ZIndex = 0;
        screenshotButton.ZIndex = 5;
        adaptiveToggleHost.ZIndex = 6;
        adaptiveComposer.ZIndex = 6;
        inspectorResizeTrack.ZIndex = 3;
        inspector.ZIndex = 2;
        reconnectBanner.ZIndex = 4;
        restoreOverlay.ZIndex = 4;

        var closeButton = new Button
        {
            Content = "×",
            FontSize = TabCloseFontSize(textSize),
            Padding = new Thickness(5, 0),
            MinWidth = 24,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
        };
        var statusGlyph = new TextBlock
        {
            Text = "●",
            FontSize = TabIconFontSize(textSize),
            Foreground = StartingBrush,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (!isLocalShell) ToolTip.SetTip(statusGlyph, $"{providerLabel} terminal");
        var titleBlock = new TextBlock
        {
            Text = title,
            FontSize = tabFontSize,
            MaxWidth = 220,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var inlineRenameBox = new TextBox
        {
            Text = title,
            FontSize = tabFontSize,
            Width = 220,
            MinWidth = 120,
            Padding = new Thickness(5, 1),
            IsVisible = false,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ToolTip.SetTip(titleBlock, "Double-click to rename this session");
        AutomationProperties.SetHelpText(titleBlock, "Double-click to rename this session");
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 7,
            Children =
            {
                statusGlyph,
                titleBlock,
                inlineRenameBox,
                closeButton,
            },
        };
        var tab = new TabItem
        {
            Header = header,
            Content = content,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
        };
        AutomationProperties.SetName(tab, title);
        var state = new SessionTabState(
            key, tab, terminal, content, screenshotButton,
            adaptiveToggleButton, adaptivePulseHalo, adaptiveComposer, adaptivePromptBox, adaptiveSendButton, adaptiveRouteText,
            inspector, inspectorBody, inspectorHeading, inspectorToggleButton, inspectorSplitter,
            inspectorResizeTrack, inspectorResizeGrip,
            reconnectBanner, reconnectText, reconnectButton,
            restoreOverlay, restoreText,
            titleBlock, statusGlyph, contextText, contextBar, contextDonut,
            detailHeadings, configText,
            promptText, renameBox, renameButton, archiveButton, summaryButton, stopButton,
            workingDirectory, session, kind, pane, providerId);

        ApplyThemeToSessionState(state, EffectivePaneTheme(pane));
        screenshotButton.Click += async (_, _) => await CaptureAndPasteScreenshotAsync(state);
        adaptiveToggleButton.Click += async (_, _) =>
            await SetPaneAdaptiveEnabledAsync(pane, adaptiveToggleButton.IsChecked == true);
        adaptiveSendButton.Click += async (_, _) => await SubmitAdaptivePromptAsync(state);
        adaptivePromptBox.AddHandler(
            InputElement.KeyDownEvent,
            async (_, args) =>
            {
                if (args.Key != Key.Enter || args.KeyModifiers.HasFlag(KeyModifiers.Shift)) return;
                args.Handled = true;
                await SubmitAdaptivePromptAsync(state);
            },
            RoutingStrategies.Tunnel,
            handledEventsToo: true);
        UpdateAdaptiveControls(state);
        var inspectorDragActive = false;
        var inspectorDragStartY = 0d;
        var inspectorDragStartHeight = pane.InspectorHeight;
        inspectorSplitter.PointerPressed += (_, args) =>
        {
            if (pane.InspectorCollapsed
                || !args.GetCurrentPoint(inspectorSplitter).Properties.IsLeftButtonPressed) return;
            inspectorDragActive = true;
            inspectorDragStartY = args.GetPosition(content).Y;
            inspectorDragStartHeight = Math.Clamp(
                content.RowDefinitions[InspectorRow].ActualHeight,
                InspectorMinimumHeight,
                InspectorMaximumHeight);
            args.Pointer.Capture(inspectorSplitter);
            args.Handled = true;
        };
        inspectorSplitter.PointerMoved += (_, args) =>
        {
            if (!inspectorDragActive) return;
            var verticalChange = args.GetPosition(content).Y - inspectorDragStartY;
            pane.InspectorHeight = Math.Clamp(
                inspectorDragStartHeight - verticalChange,
                InspectorMinimumHeight,
                InspectorMaximumHeight);
            ApplyPaneInspectorHeight(pane);
            args.Handled = true;
        };
        inspectorSplitter.PointerReleased += (_, args) =>
        {
            if (!inspectorDragActive) return;
            inspectorDragActive = false;
            args.Pointer.Capture(null);
            ApplyPaneInspectorHeight(pane);
            _ = SaveWorkspaceAsync();
            args.Handled = true;
        };
        inspectorToggleButton.Click += (_, _) =>
        {
            pane.InspectorCollapsed = !pane.InspectorCollapsed;
            ApplyPaneInspectorHeight(pane);
            _ = SaveWorkspaceAsync();
        };
        var inlineRenameFinishing = false;
        async Task FinishInlineRenameAsync(bool save)
        {
            if (!inlineRenameBox.IsVisible || inlineRenameFinishing) return;
            inlineRenameFinishing = true;
            try
            {
                var nextTitle = inlineRenameBox.Text?.Trim();
                if (save && !string.IsNullOrWhiteSpace(nextTitle))
                {
                    state.RenameBox.Text = nextTitle;
                    await RenameSessionAsync(state);
                }
            }
            finally
            {
                inlineRenameBox.IsVisible = false;
                titleBlock.IsVisible = true;
                inlineRenameFinishing = false;
            }
        }
        titleBlock.DoubleTapped += (_, args) =>
        {
            args.Handled = true;
            inlineRenameBox.Text = titleBlock.Text;
            titleBlock.IsVisible = false;
            inlineRenameBox.IsVisible = true;
            inlineRenameBox.Focus();
            inlineRenameBox.SelectAll();
        };
        inlineRenameBox.KeyDown += async (_, args) =>
        {
            if (args.Key == Key.Enter)
            {
                args.Handled = true;
                await FinishInlineRenameAsync(save: true);
            }
            else if (args.Key == Key.Escape)
            {
                args.Handled = true;
                await FinishInlineRenameAsync(save: false);
            }
        };
        inlineRenameBox.LostFocus += async (_, _) => await FinishInlineRenameAsync(save: true);
        terminal.Loaded += (_, _) => AttachTerminalVisualStyling(state);

        closeButton.Click += async (_, _) => await DetachTabAsync(state);
        stopButton.Click += async (_, _) => await StopAndRemoveTabAsync(state);
        summaryButton.Click += async (_, _) =>
        {
            if (state.Session is not null) await OpenPreviewAsync(state.Session, state.Pane);
        };
        renameButton.Click += async (_, _) => await RenameSessionAsync(state);
        archiveButton.Click += async (_, _) =>
        {
            if (!state.ArchiveConfirmationPending)
            {
                state.ArchiveConfirmationPending = true;
                archiveButton.Content = "Confirm archive";
                archiveButton.Foreground = ErrorBrush;
                return;
            }
            ResetArchiveConfirmation(state);
            await ArchiveSessionAsync(state);
        };
        archiveButton.LostFocus += (_, _) => ResetArchiveConfirmation(state);
        reconnectButton.Click += (_, _) => state.ReconnectNow?.TrySetResult(true);
        terminal.ProcessExited += (_, args) => OnTerminalProcessExited(state, args);
        return state;
    }

    private double TerminalTabContentHeight(double fallbackHeight = 0)
    {
        var workspaceHeight = PaneWorkspaceScroll.Bounds.Height;
        if (workspaceHeight <= 0) workspaceHeight = fallbackHeight;
        return Math.Max(240, workspaceHeight - 46);
    }

    private async void OnTerminalPasteKeyDown(object? sender, KeyEventArgs args)
    {
        var primary = (args.KeyModifiers & (OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control)) != 0;
        var control = (args.KeyModifiers & KeyModifiers.Control) != 0;
        var meta = (args.KeyModifiers & KeyModifiers.Meta) != 0;
        var shift = (args.KeyModifiers & KeyModifiers.Shift) != 0;
        var alt = (args.KeyModifiers & KeyModifiers.Alt) != 0;
        var standardPaste = args.Key == Key.V && primary && !alt;
        var terminalPaste = args.Key == Key.Insert && shift && !control && !meta && !alt;
        if (!standardPaste && !terminalPaste) return;

        args.Handled = true;
        if (sender is not TerminalControl terminal) return;
        var terminalView = args.Source as TerminalView
            ?? terminal.GetVisualDescendants().OfType<TerminalView>().FirstOrDefault();
        if (terminalView is null) return;

        try
        {
            terminalView.Focus();
            var state = _openTabs.Values.FirstOrDefault(candidate =>
                ReferenceEquals(candidate.Terminal, terminal));
            if (state?.Kind == TerminalSessionKind.Codex
                && await TryPasteClipboardScreenshotAsync(state, terminalView))
            {
                return;
            }
            await terminalView.PasteAsync();
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Terminal paste failed: {ex}");
            SetStatus($"Paste failed: {ex.Message}", ErrorBrush);
        }
    }

    private async Task<bool> TryPasteClipboardScreenshotAsync(
        SessionTabState state,
        TerminalView terminalView)
    {
        var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;
        if (clipboard is null) return false;

        Bitmap? bitmap;
        try
        {
            bitmap = await clipboard.TryGetBitmapAsync();
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Clipboard bitmap probe failed; falling back to text paste: {ex}");
            return false;
        }
        if (bitmap is null) return false;

        using (bitmap)
        {
            var pixels = (long)bitmap.PixelSize.Width * bitmap.PixelSize.Height;
            if (pixels <= 0 || pixels > _settings.ScreenshotMaximumPixels)
                throw new InvalidOperationException(
                    $"Clipboard image is too large ({bitmap.PixelSize.Width}×{bitmap.PixelSize.Height}).");

            var captureRoot = _settings.EffectiveScreenshotCaptureDirectory;
            CleanupScreenshotCaptures(captureRoot, _settings.ScreenshotRetention);
            var sessionFolder = CreateScreenshotSessionDirectory(captureRoot, state.Key);
            var fileName = $"capture-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.png";
            var hostPath = Path.Combine(sessionFolder, fileName);
            bitmap.Save(hostPath);

            var attachmentPath = await ResolveScreenshotAttachmentPathAsync(hostPath);
            var composerReference = ScreenshotAttachmentPath.ComposerReference(attachmentPath);
            if (state.Pane.AdaptiveEnabled && state.Session is not null)
            {
                InsertAdaptiveComposerText(state.AdaptivePromptBox, composerReference);
                SetStatus(
                    $"Screenshot added to Adaptive prompt · {bitmap.PixelSize.Width}×{bitmap.PixelSize.Height} · {fileName}",
                    RunningBrush);
                return true;
            }
            Exception? restoreError = null;
            try
            {
                await clipboard.SetTextAsync(composerReference);
                await terminalView.PasteAsync();
            }
            finally
            {
                try { await clipboard.SetBitmapAsync(bitmap); }
                catch (Exception ex) { restoreError = ex; }
            }

            if (restoreError is not null)
                NativeLog.Write($"Screenshot pasted but clipboard bitmap restore failed: {restoreError}");
            SetStatus(
                $"Screenshot attached · {bitmap.PixelSize.Width}×{bitmap.PixelSize.Height} · {fileName}",
                RunningBrush);
            return true;
        }
    }

    private static void InsertAdaptiveComposerText(TextBox composer, string text)
    {
        var current = composer.Text ?? string.Empty;
        var selectionStart = Math.Clamp(Math.Min(composer.SelectionStart, composer.SelectionEnd), 0, current.Length);
        var selectionEnd = Math.Clamp(Math.Max(composer.SelectionStart, composer.SelectionEnd), 0, current.Length);
        composer.Text = current[..selectionStart] + text + current[selectionEnd..];
        composer.CaretIndex = selectionStart + text.Length;
        composer.SelectionStart = composer.CaretIndex;
        composer.SelectionEnd = composer.CaretIndex;
        composer.Focus();
    }

    private async Task CaptureAndPasteScreenshotAsync(SessionTabState state)
    {
        if (_screenshotCaptureInProgress)
        {
            SetStatus("Finish the active screenshot capture first.", StartingBrush);
            return;
        }
        if (!OperatingSystem.IsWindows() && !OperatingSystem.IsMacOS())
        {
            SetStatus("Screen capture is available only in the Windows and macOS native apps.", ErrorBrush);
            return;
        }

        AttachTerminalVisualStyling(state);
        var terminalView = state.TerminalView
            ?? state.Terminal.GetVisualDescendants().OfType<TerminalView>().FirstOrDefault();
        if (terminalView is null)
        {
            SetStatus("The terminal must be ready before capturing a screenshot.", StartingBrush);
            return;
        }

        _screenshotCaptureInProgress = true;
        SetScreenshotCaptureButtonsEnabled(false);
        try
        {
            if (OperatingSystem.IsMacOS())
            {
                var startInfo = new System.Diagnostics.ProcessStartInfo("/usr/sbin/screencapture")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                startInfo.ArgumentList.Add("-i");
                startInfo.ArgumentList.Add("-c");
                using var process = System.Diagnostics.Process.Start(startInfo)
                    ?? throw new InvalidOperationException("Could not start macOS screen capture.");
                SetStatus("Select a screen region; it will attach automatically.", StartingBrush);
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
                try
                {
                    await process.WaitForExitAsync(timeout.Token);
                }
                catch (OperationCanceledException) when (timeout.IsCancellationRequested)
                {
                    try { process.Kill(entireProcessTree: true); } catch { }
                    SetStatus("Screenshot capture was canceled or timed out.", StartingBrush);
                    return;
                }
                if (process.ExitCode != 0 || !await TryPasteClipboardScreenshotAsync(state, terminalView))
                {
                    SetStatus("Screenshot capture was canceled.", StartingBrush);
                    return;
                }
                Activate();
                terminalView.Focus();
                return;
            }

            var clipboardSequence = GetClipboardSequenceNumber();
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-screenclip:")
            {
                UseShellExecute = true,
            });
            SetStatus("Select a screen region; it will attach automatically.", StartingBrush);

            var deadline = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(60);
            while (DateTimeOffset.UtcNow < deadline)
            {
                await Task.Delay(150);
                if (GetClipboardSequenceNumber() == clipboardSequence) continue;
                if (!await TryPasteClipboardScreenshotAsync(state, terminalView)) continue;

                Activate();
                terminalView.Focus();
                return;
            }
            SetStatus("Screenshot capture was canceled or timed out.", StartingBrush);
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Screenshot capture failed: {ex}");
            SetStatus($"Screenshot capture failed: {ex.Message}", ErrorBrush);
        }
        finally
        {
            _screenshotCaptureInProgress = false;
            SetScreenshotCaptureButtonsEnabled(true);
        }
    }

    private void SetScreenshotCaptureButtonsEnabled(bool enabled)
    {
        foreach (var candidate in _openTabs.Values)
            candidate.ScreenshotButton.IsEnabled = enabled;
    }

    private async Task<string> ResolveScreenshotAttachmentPathAsync(string hostPath)
    {
        if (!_platform.UsesWsl)
        {
            if (!Path.IsPathRooted(hostPath))
                throw new InvalidOperationException("Screenshot attachment path must be absolute.");
            return Path.GetFullPath(hostPath);
        }

        try
        {
            var wslExecutable = Path.Combine(Environment.SystemDirectory, "wsl.exe");
            var startInfo = new System.Diagnostics.ProcessStartInfo(wslExecutable)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            startInfo.ArgumentList.Add("--distribution");
            startInfo.ArgumentList.Add(_settings.Distribution);
            startInfo.ArgumentList.Add("--exec");
            startInfo.ArgumentList.Add("wslpath");
            startInfo.ArgumentList.Add("-a");
            startInfo.ArgumentList.Add("-u");
            startInfo.ArgumentList.Add(hostPath);
            using var process = System.Diagnostics.Process.Start(startInfo)
                ?? throw new InvalidOperationException("Could not start wsl.exe.");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var outputTask = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var errorTask = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var output = (await outputTask).Trim();
            var error = (await errorTask).Trim();
            if (process.ExitCode == 0
                && output.StartsWith("/", StringComparison.Ordinal)
                && !output.Any(char.IsControl))
            {
                return output;
            }
            if (!string.IsNullOrWhiteSpace(error))
                NativeLog.Write($"wslpath failed for screenshot attachment: {error}");
        }
        catch (Exception ex)
        {
            NativeLog.Write($"wslpath screenshot resolution failed; using standard mount fallback: {ex}");
        }
        return ScreenshotAttachmentPath.ToWslPath(hostPath);
    }

    private static string ScreenshotSessionFolder(string sessionKey)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sessionKey));
        return Convert.ToHexString(hash)[..12].ToLowerInvariant();
    }

    private static string CreateScreenshotSessionDirectory(string captureRoot, string sessionKey)
    {
        Directory.CreateDirectory(captureRoot);
        var sessionFolder = Path.Combine(captureRoot, ScreenshotSessionFolder(sessionKey));
        if (Directory.Exists(sessionFolder)
            && (File.GetAttributes(sessionFolder) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidOperationException("Screenshot session directory cannot be a symbolic link.");
        }
        Directory.CreateDirectory(sessionFolder);
        return sessionFolder;
    }

    private static void CleanupScreenshotCaptures(string captureRoot, TimeSpan retention)
    {
        if (!Directory.Exists(captureRoot)) return;
        var cutoff = DateTime.UtcNow - retention;
        try
        {
            foreach (var directory in Directory.EnumerateDirectories(captureRoot, "*", SearchOption.TopDirectoryOnly))
            {
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) continue;
                try
                {
                    foreach (var file in Directory.EnumerateFiles(directory, "capture-*.png", SearchOption.TopDirectoryOnly))
                    {
                        if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) continue;
                        if (File.GetLastWriteTimeUtc(file) < cutoff) File.Delete(file);
                    }
                    if (!Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory);
                }
                catch { }
            }
        }
        catch { }
    }

    private void OnTerminalPointerWheelChanged(object? sender, PointerWheelEventArgs args)
    {
        if (sender is not TerminalControl terminal || args.Delta.Y == 0) return;
        var terminalView = args.Source as TerminalView
            ?? terminal.GetVisualDescendants().OfType<TerminalView>().FirstOrDefault();
        if (terminalView is null) return;

        terminalView.Focus();
        terminalView.ViewportY = TerminalViewportScroll.Next(
            terminalView.ViewportY,
            terminalView.MaxScrollback,
            args.Delta.Y);
        args.Handled = true;
    }

    private StackPanel DetailColumn(string heading, Control? leading, TextBlock body, int column)
    {
        var panel = new StackPanel { Spacing = 1 };
        panel.Children.Add(new TextBlock
        {
            Text = heading,
            FontWeight = FontWeight.Bold,
            FontSize = 11,
            Foreground = ResourceBrush("AccentBrush"),
        });
        if (leading is not null)
        {
            panel.Children.Add(leading);
        }
        panel.Children.Add(body);
        Grid.SetColumn(panel, column);
        return panel;
    }

    private StackPanel ContextDetailColumn(ContextDonutControl donut, ProgressBar progress, TextBlock body, int column)
    {
        var details = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        details.Children.Add(progress);
        details.Children.Add(body);
        var composition = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
        composition.Children.Add(donut);
        composition.Children.Add(details);
        Grid.SetColumn(details, 1);
        var panel = new StackPanel { Spacing = 1 };
        panel.Children.Add(new TextBlock
        {
            Text = "CONTEXT",
            FontWeight = FontWeight.Bold,
            FontSize = 11,
            Foreground = ResourceBrush("AccentBrush"),
        });
        panel.Children.Add(composition);
        Grid.SetColumn(panel, column);
        return panel;
    }

    private TextBlock MakeDetailText(string text) => new()
    {
        Text = text,
        Foreground = ResourceBrush("SecondaryBrush"),
        FontSize = 11,
        TextWrapping = TextWrapping.Wrap,
        MaxLines = 4,
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    private async Task<bool> LaunchTerminalAsync(SessionTabState state, bool reconnecting = false)
    {
        if (IsCodexSession(state) && state.Session is not null)
        {
            BeginTerminalStartupReveal(state, reconnecting);
        }
        try
        {
            var hostExecutable = Path.Combine(AppContext.BaseDirectory, _platform.TerminalHostFileName);
            var spec = state.Kind switch
            {
                TerminalSessionKind.Codex => NativeLaunchBuilder.ServerTerminal(
                    hostExecutable,
                    _api.TerminalWebSocketUri(
                        state.Key,
                        adaptive: IsCodexSession(state) && state.Pane.AdaptiveEnabled,
                        providerId: state.ProviderId).AbsoluteUri),
                TerminalSessionKind.LocalShell => NativeLaunchBuilder.LocalShell(
                    _platform.Platform,
                    hostExecutable,
                    _settings.Distribution,
                    state.WorkingDirectory,
                    Environment.GetEnvironmentVariable("SHELL")),
                _ => throw new ArgumentOutOfRangeException(nameof(state)),
            };
            state.StatusGlyph.Foreground = StartingBrush;
            state.StopButton.Content = "Stop";
            SetStatus(
                state.Kind == TerminalSessionKind.LocalShell
                    ? $"Starting {_platform.LocalShellLabel} in {state.WorkingDirectory}…"
                    : $"Attaching {state.TitleBlock.Text} to persistent {_platform.DisplayName} terminal…",
                StartingBrush);
            await state.Terminal.LaunchProcess(spec.WorkingDirectory, spec.Process, spec.Arguments.ToArray());
            state.IsLaunched = true;
            state.IsRunning = true;
            state.ReconnectAttempt = 0;
            state.ReconnectBanner.IsVisible = false;
            state.StatusGlyph.Foreground = RunningBrush;
            state.Terminal.Focus();
            SetStatus(
                state.Kind == TerminalSessionKind.LocalShell
                    ? $"{_platform.LocalShellLabel} ready · host PID {state.Terminal.Pid} · {state.WorkingDirectory}"
                    : reconnecting
                        ? $"Reconnected {state.TitleBlock.Text} · bridge PID {state.Terminal.Pid}"
                        : $"Connected · bridge PID {state.Terminal.Pid} · server PTY survives app exit",
                RunningBrush);
            return true;
        }
        catch (Exception ex)
        {
            EndTerminalStartupReveal(state);
            state.IsLaunched = false;
            state.IsRunning = false;
            state.StatusGlyph.Foreground = ErrorBrush;
            NativeLog.Write($"Terminal launch failed for {state.Key}: {ex}");
            SetStatus(ex.Message, ErrorBrush);
            return false;
        }
    }

    private async Task EnsureTerminalLaunchedAsync(SessionTabState state)
    {
        if (state.IsLaunched && state.IsRunning)
        {
            state.Terminal.Focus();
            return;
        }
        if (state.IsLaunching) return;
        state.IsLaunching = true;
        try
        {
            await LaunchTerminalAsync(state);
        }
        finally
        {
            state.IsLaunching = false;
        }
    }

    private async Task MoveTabToPaneAsync(SessionTabState state, TerminalPaneState targetPane)
    {
        if (ReferenceEquals(state.Pane, targetPane)) return;
        var sourcePane = state.Pane;
        var adaptiveModeChanged = sourcePane.AdaptiveEnabled != targetPane.AdaptiveEnabled;
        if (state.IsAttached) sourcePane.Tabs.Items.Remove(state.Tab);
        state.Pane = targetPane;
        ApplyPaneInspectorHeight(targetPane);
        UpdateAdaptiveControls(state);
        ApplyPaneTheme(sourcePane);
        ApplyPaneTheme(targetPane);
        if (state.IsAttached) AddTabToPane(targetPane, state.Tab);
        targetPane.Tabs.SelectedItem = state.Tab;
        SetActivePane(targetPane);
        UpdatePaneEmptyStates();
        if (adaptiveModeChanged && IsCodexSession(state) && state.IsLaunched)
            await RestartTerminalForAdaptiveModeAsync(state);
    }

    private void ApplyPaneInspectorHeight(TerminalPaneState pane)
    {
        var height = pane.InspectorCollapsed
            ? InspectorCollapsedHeight
            : Math.Clamp(pane.InspectorHeight, InspectorMinimumHeight, InspectorMaximumHeight);
        foreach (var state in _openTabs.Values.Where(state => ReferenceEquals(state.Pane, pane)))
        {
            if (state.TerminalViewport.RowDefinitions.Count > InspectorRow)
                state.TerminalViewport.RowDefinitions[InspectorRow].Height = new GridLength(height);
            state.Inspector.MinHeight = pane.InspectorCollapsed
                ? InspectorCollapsedHeight
                : InspectorMinimumHeight;
            state.Inspector.Padding = new Thickness(10, pane.InspectorCollapsed ? 4 : 6);
            state.InspectorBody.IsVisible = !pane.InspectorCollapsed;
            state.InspectorSplitter.IsEnabled = !pane.InspectorCollapsed;
            state.InspectorToggleButton.Content = pane.InspectorCollapsed ? "Expand" : "Collapse";
            AutomationProperties.SetName(
                state.InspectorToggleButton,
                pane.InspectorCollapsed ? "Expand session context" : "Collapse session context");
        }
    }

    private void AttachTab(SessionTabState state, bool activate = true)
    {
        state.SuppressReconnect = false;
        if (!state.IsAttached)
        {
            AddTabToPane(state.Pane, state.Tab);
            state.IsAttached = true;
        }
        if (activate)
        {
            state.Pane.Tabs.SelectedItem = state.Tab;
            SetActivePane(state.Pane);
        }
        UpdatePaneEmptyStates();
    }

    private async Task DetachTabAsync(SessionTabState state, bool selectFallback = true)
    {
        if (state.Kind == TerminalSessionKind.LocalShell)
        {
            await StopAndRemoveTabAsync(state, selectFallback);
            return;
        }
        CancelTerminalReconnect(state, suppress: true);
        EndTerminalStartupReveal(state);
        state.Pane.Tabs.Items.Remove(state.Tab);
        state.IsAttached = false;
        if (selectFallback) SelectPaneFallback(state.Pane);
        UpdatePaneEmptyStates();
        SetStatus($"Detached {state.TitleBlock.Text} · persistent {_platform.DisplayName} process continues", RunningBrush);
        await SaveWorkspaceAsync();
    }

    private async Task StopAndRemoveTabAsync(SessionTabState state, bool selectFallback = true)
    {
        CancelTerminalReconnect(state, suppress: true);
        EndTerminalStartupReveal(state);
        if (state.Kind == TerminalSessionKind.Codex)
        {
            try { await _api.KillTerminalAsync(state.Key, providerId: state.ProviderId); }
            catch (Exception ex) { NativeLog.Write($"Server PTY stop failed for {state.Key}: {ex.Message}"); }
        }
        state.Terminal.Kill();
        state.IsRunning = false;
        state.IsLaunched = false;
        state.Pane.Tabs.Items.Remove(state.Tab);
        state.IsAttached = false;
        _openTabs.Remove(OpenTabRegistryKey(state));
        UpdatePaneAdaptiveControls(state.Pane);
        if (selectFallback) SelectPaneFallback(state.Pane);
        UpdatePaneEmptyStates();
        SetStatus($"Stopped {state.TitleBlock.Text}", StartingBrush);
        await SaveWorkspaceAsync();
    }

    private void SelectPaneFallback(TerminalPaneState pane)
    {
        pane.Tabs.SelectedItem = PaneContentTabs(pane).LastOrDefault();
        if (pane.Tabs.SelectedItem is null && ReferenceEquals(pane, _panes[0]))
            pane.Tabs.SelectedItem = DashboardTab;
    }

    private void ResetArchiveConfirmation(SessionTabState state)
    {
        state.ArchiveConfirmationPending = false;
        state.ArchiveButton.Content = "Archive";
        state.ArchiveButton.Foreground = ResourceBrush("PrimaryBrush");
    }

    private static void CancelTerminalReconnect(SessionTabState state, bool suppress)
    {
        state.SuppressReconnect = suppress;
        state.ReconnectCancellation?.Cancel();
        state.ReconnectNow?.TrySetCanceled();
        state.ReconnectBanner.IsVisible = false;
    }

    private void BeginTerminalStartupReveal(SessionTabState state, bool reconnecting)
    {
        EndTerminalStartupReveal(state);
        state.TerminalStartupGate = new TerminalStartupGate(DateTimeOffset.UtcNow);
        state.TerminalStartupAllowsQuietReveal = reconnecting
            || state.Session?.Status is "active" or "question";
        state.Terminal.Opacity = 0;
        state.Terminal.IsHitTestVisible = false;
        state.RestoreText.Text = reconnecting ? "Restoring terminal view…" : "Restoring conversation…";
        state.RestoreOverlay.IsVisible = true;
        StartTerminalRevealTimer(state);
    }

    private void StartTerminalRevealTimer(SessionTabState state)
    {
        state.TerminalStartupTimer?.Stop();
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(75) };
        timer.Tick += (_, _) =>
        {
            var terminalReady = state.TerminalStartupAllowsQuietReveal || IsCodexComposerReady(state);
            if (state.TerminalStartupGate?.ShouldReveal(DateTimeOffset.UtcNow, terminalReady) == true)
            {
                EndTerminalStartupReveal(state);
            }
        };
        state.TerminalStartupTimer = timer;
        timer.Start();
    }

    private void EndTerminalStartupReveal(SessionTabState state)
    {
        state.TerminalStartupTimer?.Stop();
        state.TerminalStartupTimer = null;
        state.TerminalStartupGate = null;
        state.TerminalStartupAllowsQuietReveal = false;
        AutomationProperties.SetHelpText(state.InspectorSplitter, "Drag to resize session details");
        state.RestoreOverlay.IsVisible = false;
        state.Terminal.Opacity = 1;
        state.Terminal.IsHitTestVisible = true;
        RestyleTerminalText(state);
        state.TerminalView?.InvalidateVisual();
        state.Terminal.InvalidateVisual();
        if (state.IsAttached && ReferenceEquals(state.Pane.Tabs.SelectedItem, state.Tab))
        {
            state.Terminal.Focus();
        }
    }

    private void BeginTerminalReconnect(SessionTabState state, int exitCode)
    {
        if (state.Kind != TerminalSessionKind.Codex
            || _shutdownConfirmed
            || state.SuppressReconnect
            || !state.IsAttached
            || state.ReconnectLoopActive) return;
        state.ReconnectLoopActive = true;
        state.ReconnectCancellation?.Cancel();
        state.ReconnectCancellation?.Dispose();
        state.ReconnectCancellation = new CancellationTokenSource();
        _ = ReconnectTerminalAsync(state, exitCode, state.ReconnectCancellation.Token);
    }

    private async Task ReconnectTerminalAsync(SessionTabState state, int exitCode, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested
                   && !_shutdownConfirmed
                   && !state.SuppressReconnect
                   && state.IsAttached)
            {
                state.ReconnectAttempt++;
                var delay = state.ReconnectAttempt switch
                {
                    1 => TimeSpan.FromSeconds(1),
                    2 => TimeSpan.FromSeconds(2),
                    3 => TimeSpan.FromSeconds(5),
                    4 => TimeSpan.FromSeconds(10),
                    _ => TimeSpan.FromSeconds(20),
                };
                state.ReconnectText.Text =
                    $"Connection lost (exit {exitCode}) · retry {state.ReconnectAttempt} in {delay.TotalSeconds:0}s";
                state.ReconnectBanner.IsVisible = true;
                state.StatusGlyph.Foreground = StartingBrush;
                SetStatus($"{state.TitleBlock.Text} disconnected · reconnecting automatically", StartingBrush);

                state.ReconnectNow = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                var timer = Task.Delay(delay, cancellationToken);
                await Task.WhenAny(timer, state.ReconnectNow.Task);
                cancellationToken.ThrowIfCancellationRequested();
                if (_shutdownConfirmed || state.SuppressReconnect || !state.IsAttached) return;

                state.IsLaunching = true;
                var connected = false;
                try
                {
                    connected = await LaunchTerminalAsync(state, reconnecting: true);
                }
                finally
                {
                    state.IsLaunching = false;
                }
                if (connected) return;
            }
        }
        catch (OperationCanceledException)
        {
            // Detach, Stop, and application shutdown deliberately cancel reconnect.
        }
        finally
        {
            state.ReconnectNow = null;
            state.ReconnectLoopActive = false;
            if (!state.IsRunning) state.ReconnectBanner.IsVisible = false;
        }
    }

    private async Task LoadSessionDetailsAsync(SessionTabState state, DashboardSession session)
    {
        try
        {
            var contextTask = _api.GetContextAsync(session.Id, providerId: state.ProviderId);
            var configTask = _api.GetConfigAsync(session.Id, providerId: state.ProviderId);
            await Task.WhenAll(contextTask, configTask);
            var context = contextTask.Result;
            var config = configTask.Result;
            var percent = context.MaxContext > 0 ? context.TotalUsed * 100d / context.MaxContext : 0;
            state.ContextBar.Value = Math.Clamp(percent, 0, 100);
            state.ContextDonut.SetData(new (string Label, long Value)[]
            {
                ("System prompt", context.Categories.SystemPrompt),
                ("User messages", context.Categories.UserMessages),
                ("Assistant messages", context.Categories.AssistantMessages),
                ("Tool calls", context.Categories.ToolCalls),
                ("Tool results", context.Categories.ToolResults),
                ("Free", context.FreeTokens),
            });
            state.ContextText.Text =
                $"{FormatNumber(context.TotalUsed)} / {FormatNumber(context.MaxContext)} ({percent:0.#}%) · " +
                $"{FormatNumber(context.FreeTokens)} free · {context.CompactionCount} compactions\n" +
                $"user {FormatNumber(context.Categories.UserMessages)} · assistant {FormatNumber(context.Categories.AssistantMessages)} · tools {FormatNumber(context.Categories.ToolCalls)}";
            var permissions = string.Join(", ", config.Permissions.Select(permission =>
                string.IsNullOrWhiteSpace(permission.Label) ? $"{permission.Scope}: {permission.Action}" : permission.Label).Distinct());
            state.ConfigText.Text =
                $"{config.Model} · {session.ReasoningEffort}\n{permissions}\n" +
                $"{config.Rules.Count} rules · {config.ActiveSkills.Count} active skills";
        }
        catch (Exception ex)
        {
            state.ContextText.Text = $"Context unavailable: {ex.Message}";
            NativeLog.Write($"Session detail load failed for {session.Id}: {ex}");
        }
    }

    private async Task RenameSessionAsync(SessionTabState state)
    {
        if (state.Session is null)
        {
            state.TitleBlock.Text = state.RenameBox.Text?.Trim() ?? state.TitleBlock.Text;
            AutomationProperties.SetName(
                state.Tab,
                state.TitleBlock.Text ?? (state.Kind == TerminalSessionKind.LocalShell
                    ? _platform.LocalShellLabel
                    : $"New {ProviderLabel(state.ProviderId)} session"));
            return;
        }
        var title = state.RenameBox.Text?.Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            return;
        }
        try
        {
            await _api.RenameAsync(state.Session.Id, title, providerId: state.ProviderId);
            state.TitleBlock.Text = title;
            AutomationProperties.SetName(state.Tab, title);
            await RefreshAllAsync();
        }
        catch (Exception ex)
        {
            SetStatus($"Rename failed: {ex.Message}", ErrorBrush);
        }
    }

    private async Task ArchiveSessionAsync(SessionTabState state)
    {
        if (state.Session is null)
        {
            return;
        }
        try
        {
            await _api.ArchiveAsync(state.Session.Id, providerId: state.ProviderId);
            await StopAndRemoveTabAsync(state);
            await RefreshAllAsync();
        }
        catch (Exception ex)
        {
            ResetArchiveConfirmation(state);
            SetStatus($"Archive failed: {ex.Message}", ErrorBrush);
        }
    }

    private void UpdateOpenTabStatuses()
    {
        foreach (var state in _openTabs.Values)
        {
            if (state.Session is null)
            {
                continue;
            }
            if (state.ProviderId != _api.ProviderId) continue;
            var current = _sessions.FirstOrDefault(session => session.Id == state.Session.Id);
            if (current is not null)
            {
                state.Session.Status = current.Status;
                state.Session.Model = current.Model;
                state.Session.ReasoningEffort = current.ReasoningEffort;
                state.PromptText.Text = current.LastUserPrompt;
                UpdateAdaptiveControls(state);
            }
        }
    }

    private void OnTerminalProcessExited(SessionTabState state, ProcessExitedEventArgs args)
    {
        Dispatcher.UIThread.Post(() =>
        {
            state.IsRunning = false;
            state.IsLaunched = false;
            if (state.Kind == TerminalSessionKind.LocalShell)
            {
                state.StatusGlyph.Foreground = args.ExitCode == 0 ? StartingBrush : ErrorBrush;
                if (_shutdownConfirmed || state.SuppressReconnect || !state.IsAttached) return;
                state.StopButton.Content = "Close";
                state.PromptText.Text = args.ExitCode == 0
                    ? "Shell exited normally. Close this tab or select it again to start a fresh shell."
                    : $"Shell exited with code {args.ExitCode}. Close this tab or select it again to retry.";
                SetStatus(
                    args.ExitCode == 0
                        ? $"{state.TitleBlock.Text} exited"
                        : $"{state.TitleBlock.Text} exited with code {args.ExitCode}",
                    args.ExitCode == 0 ? StartingBrush : ErrorBrush);
                return;
            }
            if (_shutdownConfirmed || state.SuppressReconnect || !state.IsAttached)
            {
                state.StatusGlyph.Foreground = args.ExitCode == 0 ? StartingBrush : ErrorBrush;
                return;
            }
            BeginTerminalReconnect(state, args.ExitCode);
        });
    }

    private async void OnSessionSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (SessionsList.SelectedItem is DashboardSession session)
        {
            SessionsList.SelectedItem = null;
            await RouteSelectedSessionAsync(SessionsList, session);
        }
    }

    private async void OnCompactSessionSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (CompactSessionsList.SelectedItem is not DashboardSession session) return;
        CompactSessionsList.SelectedItem = null;
        await RouteSelectedSessionAsync(CompactSessionsList, session);
    }

    private async Task RouteSelectedSessionAsync(Control anchor, DashboardSession session)
    {
        if (session.IsHeadless || session.Archived || _panes.Count == 1)
        {
            await OpenSelectedSessionAsync(session, _activePane);
            return;
        }
        ShowSessionTargetFlyout(anchor, session);
    }

    private Task OpenSelectedSessionAsync(DashboardSession session, TerminalPaneState pane) =>
        session.IsHeadless || session.Archived
            ? OpenPreviewAsync(session, pane)
            : OpenSessionAsync(session, targetPane: pane);

    private void ShowSessionTargetFlyout(Control anchor, DashboardSession session)
    {
        Flyout? flyout = null;
        var options = new StackPanel { Spacing = 4, MinWidth = 210 };
        options.Children.Add(new TextBlock
        {
            Text = "OPEN SESSION IN",
            Foreground = ResourceBrush("AccentBrush"),
            FontWeight = FontWeight.Bold,
            Margin = new Thickness(8, 4, 8, 6),
        });
        foreach (var pane in _panes)
        {
            var target = pane;
            var button = new Button
            {
                Content = $"Open in {PaneLabel(target)}",
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Padding = new Thickness(10, 7),
            };
            button.Click += async (_, _) =>
            {
                flyout?.Hide();
                await OpenSelectedSessionAsync(session, target);
            };
            options.Children.Add(button);
        }
        flyout = new Flyout
        {
            Placement = PlacementMode.Pointer,
            Content = new Border
            {
                Background = ResourceBrush("SurfaceBrush"),
                BorderBrush = ResourceBrush("BorderBrightBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(7),
                Padding = new Thickness(8),
                Child = options,
            },
        };
        FlyoutBase.SetAttachedFlyout(anchor, flyout);
        flyout.ShowAt(anchor);
    }

    private void OnCompactSessionContainerPrepared(object? sender, ContainerPreparedEventArgs e)
    {
        if (e.Container.DataContext is not DashboardSession session) return;
        AutomationProperties.SetName(e.Container, session.DisplayTitle);
        AutomationProperties.SetHelpText(e.Container, $"{session.Project}, {session.LastActivityAgo}, status {session.Status}");
        ToolTip.SetShowDelay(e.Container, 350);
        ToolTip.SetPlacement(e.Container, PlacementMode.Right);
        ToolTip.SetTip(e.Container, CreateCompactSessionToolTip(session));
    }

    private Control CreateCompactSessionToolTip(DashboardSession session) => new Border
    {
        Background = ResourceBrush("ElevatedBrush"),
        BorderBrush = ResourceBrush("BorderBrightBrush"),
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(6),
        Padding = new Thickness(10),
        MaxWidth = 340,
        Child = new StackPanel
        {
            Spacing = 4,
            Children =
            {
                new TextBlock { Text = session.DisplayTitle, Foreground = ResourceBrush("PrimaryBrush"), FontWeight = FontWeight.Bold, TextWrapping = TextWrapping.Wrap },
                new TextBlock { Text = session.DisplayMeta, Foreground = ResourceBrush("SecondaryBrush"), FontSize = 11 },
                new TextBlock { Text = $"status · {session.Status}", Foreground = ResourceBrush("AccentBrush"), FontSize = 11 },
                new TextBlock { Text = session.LastUserPrompt, Foreground = ResourceBrush("MutedBrush"), FontSize = 11, MaxLines = 2, TextWrapping = TextWrapping.Wrap, TextTrimming = TextTrimming.CharacterEllipsis },
            },
        },
    };

    private async void OnPreviewSessionClicked(object? sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (sender is Button { Tag: DashboardSession session }) await OpenPreviewAsync(session);
    }

    private async void OnRestoreSessionClicked(object? sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (sender is not Button { Tag: DashboardSession session }) return;
        try
        {
            await _api.RestoreAsync(session.Id, providerId: SessionProvider(session));
            await RefreshAllAsync();
            ArchivedCheckBox.IsChecked = false;
            SetStatus($"Restored {session.DisplayTitle}", RunningBrush);
        }
        catch (Exception ex)
        {
            SetStatus($"Restore failed: {ex.Message}", ErrorBrush);
        }
    }

    private async Task OpenPreviewAsync(
        DashboardSession session,
        TerminalPaneState? targetPane = null,
        bool activate = true)
    {
        targetPane ??= _activePane;
        var providerId = SessionProvider(session);
        session.Provider = providerId;
        var key = PreviewTabKey(providerId, session.Id);
        if (_previewTabs.TryGetValue(key, out var existing))
        {
            var existingPane = _previewPaneByTab.GetValueOrDefault(existing) ?? _panes[0];
            if (!ReferenceEquals(existingPane, targetPane))
            {
                existingPane.Tabs.Items.Remove(existing);
                AddTabToPane(targetPane, existing);
                _previewPaneByTab[existing] = targetPane;
            }
            if (activate)
            {
                targetPane.Tabs.SelectedItem = existing;
                SetActivePane(targetPane);
            }
            UpdatePaneEmptyStates();
            return;
        }
        var textSize = DashboardTextSize.Find(_settings.TextSizeId);
        var close = new Button { Content = "×", FontSize = TabCloseFontSize(textSize), Padding = new Thickness(5, 0), MinWidth = 24, Background = Brushes.Transparent, BorderThickness = new Thickness(0) };
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 7,
            Children =
            {
                new TextBlock { Text = session.IsHeadless ? "◈" : "ⓘ", FontSize = TabIconFontSize(textSize), Foreground = ResourceBrush("AccentBrush") },
                new TextBlock { Text = session.DisplayTitle, FontSize = TabHeaderFontSize(textSize), MaxWidth = 220, TextTrimming = TextTrimming.CharacterEllipsis },
                close,
            },
        };
        TabItem? tab = null;
        SessionPreviewControl? preview = null;
        void ClosePreview(bool selectDashboard = true)
        {
            if (tab is null) return;
            var pane = _previewPaneByTab.GetValueOrDefault(tab) ?? targetPane;
            RemovePreviewTab(tab, selectFallback: selectDashboard);
            if (selectDashboard) SelectPaneFallback(pane);
        }
        async Task RenamePreviewAsync(string title)
        {
            await _api.RenameAsync(session.Id, title, providerId: providerId);
            session.Title = title;
            if (header.Children.ElementAtOrDefault(1) is TextBlock titleBlock) titleBlock.Text = title;
            if (tab is not null) AutomationProperties.SetName(tab, $"Session summary: {title}");
            await RefreshSessionsAsync();
            SetStatus($"Renamed {title}", RunningBrush);
        }
        async Task ArchivePreviewAsync()
        {
            await _api.ArchiveAsync(session.Id, providerId: providerId);
            if (_openTabs.TryGetValue(ProviderTabKey(providerId, session.Id), out var openState))
                await StopAndRemoveTabAsync(openState);
            session.Archived = true;
            ClosePreview();
            await RefreshAllAsync();
            SetStatus($"Archived {session.DisplayTitle}", StartingBrush);
        }
        async Task RestorePreviewAsync()
        {
            await _api.RestoreAsync(session.Id, providerId: providerId);
            session.Archived = false;
            ArchivedCheckBox.IsChecked = false;
            await RefreshAllAsync();
            if (preview is not null) await preview.ReloadAsync();
            SetStatus($"Restored {session.DisplayTitle}", RunningBrush);
        }
        async Task ResumePreviewAsync()
        {
            if (session.IsHeadless || session.Archived) return;
            var resumePane = tab is not null
                ? _previewPaneByTab.GetValueOrDefault(tab) ?? targetPane
                : targetPane;
            ClosePreview(selectDashboard: false);
            var current = _sessions.FirstOrDefault(candidate => candidate.Id == session.Id
                && SessionProvider(candidate) == providerId) ?? session;
            await OpenSessionAsync(current, targetPane: resumePane);
        }
        preview = new SessionPreviewControl(
            _api,
            session,
            ResourceBrush,
            RenamePreviewAsync,
            ArchivePreviewAsync,
            RestorePreviewAsync,
            ResumePreviewAsync);
        tab = new TabItem { Header = header, Content = preview };
        AutomationProperties.SetName(tab, $"Session summary: {session.DisplayTitle}");
        close.Click += (_, _) =>
        {
            ClosePreview();
        };
        _previewTabs[key] = tab;
        _previewPaneByTab[tab] = targetPane;
        _previewSessionByTab[tab] = session;
        AddTabToPane(targetPane, tab);
        if (activate)
        {
            targetPane.Tabs.SelectedItem = tab;
            SetActivePane(targetPane);
        }
        UpdatePaneEmptyStates();
        await Task.CompletedTask;
    }

    private void RemovePreviewTab(TabItem tab, bool selectFallback = true)
    {
        var pane = _previewPaneByTab.GetValueOrDefault(tab) ?? _panes[0];
        pane.Tabs.Items.Remove(tab);
        _previewPaneByTab.Remove(tab);
        _previewSessionByTab.Remove(tab);
        var preview = _previewTabs.FirstOrDefault(entry => ReferenceEquals(entry.Value, tab));
        if (!string.IsNullOrEmpty(preview.Key)) _previewTabs.Remove(preview.Key);
        if (selectFallback) SelectPaneFallback(pane);
        UpdatePaneEmptyStates();
        _ = SaveWorkspaceAsync();
    }

    private void OnNewSessionClicked(object? sender, RoutedEventArgs e)
    {
        if (sender is Control anchor) ShowNewSessionChooser(anchor, _activePane);
    }

    private void ShowNewSessionChooser(Control anchor, TerminalPaneState? initialPane = null)
    {
        _newSessionFlyout?.Hide();
        var selectedPane = initialPane is not null && _panes.Contains(initialPane) ? initialPane : _activePane;
        var candidates = _repos
            .Where(repo => !string.IsNullOrWhiteSpace(repo.WorkingDir))
            .GroupBy(repo => repo.WorkingDir, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToList();
        if (candidates.All(repo => repo.WorkingDir != _settings.WorkingDirectory))
        {
            candidates.Add(new DashboardRepo
            {
                WorkingDir = _settings.WorkingDirectory,
                Project = _settings.WorkingDirectory.TrimEnd('/').Split('/').LastOrDefault() ?? _settings.WorkingDirectory,
            });
        }
        var selected = (RepoComboBox.SelectedItem as RepoFilter)?.WorkingDir;
        var providerLabel = CurrentProviderLabel;
        var providerNoun = ProviderNoun(_api.ProviderId);
        candidates = candidates
            .OrderBy(repo => repo.WorkingDir == selected ? 0 : 1)
            .ThenBy(repo => repo.Project, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var selectedKind = TerminalSessionKind.Codex;

        var search = new TextBox
        {
            Width = 380,
            PlaceholderText = "Filter projects or paths…",
        };
        AutomationProperties.SetName(search, "Filter projects for the new session");
        var options = new StackPanel { Spacing = 4 };
        void RenderOptions()
        {
            options.Children.Clear();
            var query = (search.Text ?? string.Empty).Trim();
            var visible = candidates.Where(repo =>
                string.IsNullOrWhiteSpace(query)
                || repo.Project.Contains(query, StringComparison.OrdinalIgnoreCase)
                || repo.WorkingDir.Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();
            foreach (var repo in visible)
            {
                var label = string.IsNullOrWhiteSpace(repo.Project) ? repo.WorkingDir : repo.Project;
                var button = new Button
                {
                    HorizontalContentAlignment = HorizontalAlignment.Stretch,
                    Padding = new Thickness(10, 7),
                    Content = new StackPanel
                    {
                        Spacing = 2,
                        Children =
                        {
                            new TextBlock { Text = label, Foreground = ResourceBrush("PrimaryBrush"), FontWeight = FontWeight.SemiBold },
                            new TextBlock { Text = repo.WorkingDir, Foreground = ResourceBrush("SecondaryBrush"), FontSize = 10, TextTrimming = TextTrimming.CharacterEllipsis },
                        },
                    },
                };
                AutomationProperties.SetName(
                    button,
                    selectedKind == TerminalSessionKind.LocalShell
                        ? $"Start new {_platform.LocalShellLabel} session in {label}"
                        : $"Start new {providerLabel} session in {label}");
                button.Click += async (_, _) =>
                {
                    _newSessionFlyout?.Hide();
                    if (selectedKind == TerminalSessionKind.LocalShell)
                        await OpenLocalShellSessionAsync(repo.WorkingDir, selectedPane);
                    else
                        await OpenNewSessionAsync(repo.WorkingDir, selectedPane);
                };
                options.Children.Add(button);
            }
            if (visible.Count == 0)
                options.Children.Add(new TextBlock { Text = "No matching projects", Foreground = ResourceBrush("MutedBrush"), Margin = new Thickness(8) });
        }

        var codexChoice = new Button
        {
            Content = providerNoun,
            Padding = new Thickness(12, 8),
            HorizontalContentAlignment = HorizontalAlignment.Center,
        };
        var localShellChoice = new Button
        {
            Content = _platform.LocalShellLabel,
            Padding = new Thickness(12, 8),
            HorizontalContentAlignment = HorizontalAlignment.Center,
        };
        Grid.SetColumn(localShellChoice, 1);
        AutomationProperties.SetName(codexChoice, $"Choose {providerLabel} session");
        AutomationProperties.SetName(localShellChoice, $"Choose {_platform.LocalShellLabel} session");
        var choiceHelp = new TextBlock
        {
            Foreground = ResourceBrush("SecondaryBrush"),
            FontSize = 10,
            TextWrapping = TextWrapping.Wrap,
        };
        void RenderChoice()
        {
            var codexSelected = selectedKind == TerminalSessionKind.Codex;
            codexChoice.Background = ResourceBrush(codexSelected ? "HoverBrush" : "ElevatedBrush");
            codexChoice.BorderBrush = ResourceBrush(codexSelected ? "AccentBrush" : "BorderBrush");
            localShellChoice.Background = ResourceBrush(codexSelected ? "ElevatedBrush" : "HoverBrush");
            localShellChoice.BorderBrush = ResourceBrush(codexSelected ? "BorderBrush" : "AccentBrush");
            AutomationProperties.SetItemStatus(codexChoice, codexSelected ? "Selected" : "Not selected");
            AutomationProperties.SetItemStatus(localShellChoice, codexSelected ? "Not selected" : "Selected");
            choiceHelp.Text = codexSelected
                ? $"Start or register a persistent {providerLabel} CLI session in the selected project."
                : $"Start a direct {_platform.LocalShellLabel} in the selected project. Closing its tab ends the shell.";
        }
        codexChoice.Click += (_, _) =>
        {
            selectedKind = TerminalSessionKind.Codex;
            RenderChoice();
            RenderOptions();
        };
        localShellChoice.Click += (_, _) =>
        {
            selectedKind = TerminalSessionKind.LocalShell;
            RenderChoice();
            RenderOptions();
        };
        search.TextChanged += (_, _) => RenderOptions();
        RenderChoice();
        RenderOptions();
        var paneSelector = new ComboBox
        {
            ItemsSource = _panes.Select(PaneLabel).ToList(),
            SelectedIndex = Math.Max(0, _panes.IndexOf(selectedPane)),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(paneSelector, "Open new session in terminal pane");
        paneSelector.SelectionChanged += (_, _) =>
        {
            if (paneSelector.SelectedIndex >= 0 && paneSelector.SelectedIndex < _panes.Count)
                selectedPane = _panes[paneSelector.SelectedIndex];
        };
        var paneChoice = new Grid
        {
            ColumnDefinitions = new ColumnDefinitions("Auto,*"),
            ColumnSpacing = 8,
            Children =
            {
                new TextBlock
                {
                    Text = "OPEN IN",
                    Foreground = ResourceBrush("SecondaryBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                    FontWeight = FontWeight.Bold,
                },
                paneSelector,
            },
        };
        Grid.SetColumn(paneSelector, 1);
        var kindChoices = new Grid
        {
            ColumnDefinitions = new ColumnDefinitions("*,*"),
            ColumnSpacing = 8,
            Children = { codexChoice, localShellChoice },
        };
        var content = new StackPanel
        {
            Width = 400,
            Spacing = 8,
            Children =
            {
                new TextBlock { Text = "START NEW SESSION", Foreground = ResourceBrush("AccentBrush"), FontWeight = FontWeight.Bold },
                paneChoice,
                kindChoices,
                choiceHelp,
                search,
                new ScrollViewer
                {
                    MaxHeight = 330,
                    HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                    Content = options,
                },
            },
        };
        _newSessionFlyout = new Flyout
        {
            Content = new Border
            {
                Background = ResourceBrush("SurfaceBrush"),
                BorderBrush = ResourceBrush("BorderBrightBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(7),
                Padding = new Thickness(12),
                Child = content,
            },
        };
        _newSessionFlyout.ShowAt(anchor);
        Dispatcher.UIThread.Post(() => search.Focus(), DispatcherPriority.Input);
    }

    private async void OnHomeClicked(object? sender, RoutedEventArgs e)
    {
        SetActivePane(_panes[0]);
        WorkspaceTabs.SelectedItem = DashboardTab;
        await SaveWorkspaceAsync();
    }

    private async void OnSearchChanged(object? sender, TextChangedEventArgs e)
    {
        if (_initializingNavigation) return;
        await RefreshSearchAsync();
        await SaveWorkspaceAsync();
    }

    private async Task RefreshSearchAsync()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = new CancellationTokenSource();
        var cancellationToken = _searchCancellation.Token;
        var query = (SearchTextBox.Text ?? string.Empty).Trim();
        if (query.Length < 2)
        {
            _searchResults = null;
            ApplySessionFilter();
            return;
        }
        try
        {
            await Task.Delay(250, cancellationToken);
            _searchResults = await _api.SearchSessionsAsync(query, ArchivedCheckBox.IsChecked == true, cancellationToken);
            ApplySessionFilter();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _searchResults = null;
            SetStatus($"Deep search unavailable; showing local matches: {ex.Message}", StartingBrush);
            ApplySessionFilter();
        }
    }

    private async void OnRepoFilterChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (_initializingNavigation) return;
        _searchResults = null;
        if (!string.IsNullOrWhiteSpace(SearchTextBox.Text)) await RefreshSearchAsync();
        else ApplySessionFilter();
        await SaveWorkspaceAsync();
    }

    private async void OnFilterChanged(object? sender, RoutedEventArgs e)
    {
        if (_initializingNavigation) return;
        ApplySessionFilter();
        await SaveWorkspaceAsync();
    }

    private async void OnNavigationFilterChanged(object? sender, RoutedEventArgs e)
    {
        if (_initializingNavigation) return;
        if (ArchivedCheckBox.IsChecked == true)
        {
            try { _archivedSessions = await _api.GetArchivedSessionsAsync(); }
            catch (Exception ex) { SetStatus($"Archived sessions unavailable: {ex.Message}", ErrorBrush); }
        }
        if (!string.IsNullOrWhiteSpace(SearchTextBox.Text)) await RefreshSearchAsync();
        else ApplySessionFilter();
        await SaveWorkspaceAsync();
    }

    private async void OnColdDaysChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (_initializingNavigation || ColdDaysComboBox.SelectedIndex < 0) return;
        var values = new[] { 1, 3, 7, 14, 30 };
        _settings = _settings with { ColdDays = values[ColdDaysComboBox.SelectedIndex] };
        ApplySessionFilter();
        await SaveWorkspaceAsync();
    }

    private async void OnResetFiltersClicked(object? sender, RoutedEventArgs e)
    {
        _initializingNavigation = true;
        RepoComboBox.SelectedIndex = 0;
        ColdDaysComboBox.SelectedIndex = 1;
        ShowHeadlessCheckBox.IsChecked = false;
        ArchivedCheckBox.IsChecked = false;
        NeedsInputCheckBox.IsChecked = false;
        _initializingNavigation = false;
        _settings = _settings with { ColdDays = 3 };
        _archivedSessions = [];
        _searchResults = null;
        if (!string.IsNullOrWhiteSpace(SearchTextBox.Text)) await RefreshSearchAsync();
        else ApplySessionFilter();
        await SaveWorkspaceAsync();
    }

    private void OnSessionFiltersToggleClicked(object? sender, RoutedEventArgs e) =>
        SetSessionFiltersExpanded(SessionFiltersToggle.IsChecked == true);

    private void SetSessionFiltersExpanded(bool expanded)
    {
        SessionFiltersToggle.IsChecked = expanded;
        SessionFiltersPanel.IsVisible = expanded;
        SessionFiltersChevron.Text = expanded ? "⌃" : "⌄";
        AutomationProperties.SetItemStatus(
            SessionFiltersToggle,
            expanded ? "Expanded" : "Collapsed");
    }

    private async void OnAnalyticsWindowChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (_initializingAnalytics || AnalyticsWindowComboBox.SelectedIndex < 0) return;
        var windows = new[] { "1d", "2d", "7d", "14d", "30d", "all" };
        _settings = _settings with { AnalyticsWindow = windows[AnalyticsWindowComboBox.SelectedIndex] };
        if (_stats is not null) RenderStats(_stats);
        await SaveWorkspaceAsync();
    }

    private async void OnStatsCohortChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (_initializingAnalytics || StatsCohortComboBox.SelectedIndex < 0) return;
        var modes = new[] { "combined", "triage", "codex" };
        _settings = _settings with { StatsMode = modes[StatsCohortComboBox.SelectedIndex] };
        await PersistSettingsAsync();
        await RefreshAllAsync();
    }

    private async void OnLatestPromptClicked(object? sender, RoutedEventArgs e)
    {
        if (LatestPromptButton.Tag is DashboardSession session) await OpenPreviewAsync(session);
    }

    private async void OnSidebarToggleClicked(object? sender, RoutedEventArgs e)
    {
        _settings = _settings with
        {
            SidebarCollapsed = SidebarBorder.IsVisible,
            SidebarWidth = SidebarBorder.IsVisible
                ? Math.Clamp(MainContentGrid.ColumnDefinitions[0].ActualWidth, 240, 640)
                : _settings.SidebarWidth,
        };
        ApplySidebarState();
        await SaveWorkspaceAsync();
    }

    private async void OnSidebarResizeCompleted(object? sender, VectorEventArgs e)
    {
        if (!SidebarBorder.IsVisible) return;
        _settings = _settings with { SidebarWidth = Math.Clamp(MainContentGrid.ColumnDefinitions[0].ActualWidth, 240, 640) };
        await SaveWorkspaceAsync();
    }

    private async void OnWorkspaceTabChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (!_uiReady) return;
        var pane = sender is TabControl tabs
            ? _panes.FirstOrDefault(candidate => ReferenceEquals(candidate.Tabs, tabs)) ?? _activePane
            : _activePane;
        SetActivePane(pane);
        if (ReferenceEquals(pane.Tabs.SelectedItem, pane.SessionLauncherTab))
        {
            SelectPaneFallback(pane);
            return;
        }
        ApplyPaneTheme(pane);
        var state = _openTabs.Values.FirstOrDefault(candidate =>
            ReferenceEquals(candidate.Pane, pane)
            && ReferenceEquals(candidate.Tab, pane.Tabs.SelectedItem));
        if (state is not null) await EnsureTerminalLaunchedAsync(state);
        ApplyPaneInspectorHeight(pane);
        UpdatePaneEmptyStates();
        await SaveWorkspaceAsync();
    }

    private async void OnRefreshClicked(object? sender, RoutedEventArgs e)
    {
        _serviceStopRequested = false;
        if (!await _api.IsAvailableAsync())
        {
            await ReconcileDashboardRepositoryAsync();
            if (!await EnsureDashboardServiceAsync())
            {
                SessionCountText.Text = "Dashboard setup required";
                return;
            }
        }
        if (_statusFeed is null) StartStatusFeed();
        await RefreshAllAsync();
        if (_availableUpdate is null) _ = CheckForUpdateAsync(reportCurrent: false);
    }

    private async void OnUpdateClicked(object? sender, RoutedEventArgs e)
    {
        if (_updateInProgress)
        {
            _updateInstallCancellation?.Cancel();
            return;
        }
        if (_availableUpdate is null)
        {
            await CheckForUpdateAsync(reportCurrent: true);
            return;
        }
        await InstallAvailableUpdateAsync(_availableUpdate);
    }

    private async Task CheckForUpdateAsync(bool reportCurrent)
    {
        if (_checkingForUpdate || _updateInProgress || !UpdateButton.IsVisible) return;
        _checkingForUpdate = true;
        UpdateButton.IsEnabled = false;
        UpdateButton.Content = "Checking…";
        try
        {
            var release = await _updateService.CheckAsync(_platform);
            _availableUpdate = release;
            if (release is null)
            {
                UpdateButton.Content = "Check updates";
                ToolTip.SetTip(UpdateButton, $"Codex Native {_updateService.CurrentVersion} is current");
                if (reportCurrent) SetStatus($"Codex Native {_updateService.CurrentVersion} is up to date", RunningBrush);
            }
            else
            {
                UpdateButton.Content = $"Update {release.Version}";
                ToolTip.SetTip(UpdateButton, $"Install {release.DisplayName} after active sessions finish");
                SetStatus($"Codex Native {release.Version} is available", StartingBrush);
            }
        }
        catch (Exception ex)
        {
            UpdateButton.Content = "Check updates";
            NativeLog.Write($"Update check failed: {ex}");
            if (reportCurrent) SetStatus($"Update check failed: {ex.Message}", ErrorBrush);
        }
        finally
        {
            _checkingForUpdate = false;
            UpdateButton.IsEnabled = true;
        }
    }

    private async Task InstallAvailableUpdateAsync(NativeReleaseInfo release)
    {
        _updateInProgress = true;
        _updateInstallCancellation = new CancellationTokenSource();
        var cancellationToken = _updateInstallCancellation.Token;
        PreparedNativeUpdate? prepared = null;
        UpdateButton.IsEnabled = true;
        UpdateButton.Content = "Cancel update";
        try
        {
            SetStatus($"Downloading verified Codex Native {release.Version} package…", StartingBrush);
            var progress = new Progress<double>(value =>
            {
                UpdateButton.Content = $"Cancel · {value:P0}";
                SetStatus($"Downloading Codex Native {release.Version} · {value:P0}", StartingBrush);
            });
            prepared = await _updateService.PrepareAsync(
                release,
                _platform,
                progress,
                cancellationToken);
            await WaitForUpdateDrainAsync(cancellationToken);
            await SaveWorkspaceAsync();
            _updateService.LaunchInstaller(prepared, _platform).Dispose();
            SetStatus($"Installing Codex Native {release.Version}; restarting…", RunningBrush);
            _shutdownConfirmed = true;
            Close();
        }
        catch (OperationCanceledException)
        {
            DiscardPreparedUpdate(prepared);
            UpdateButton.Content = $"Update {release.Version}";
            SetStatus("Native update canceled", StartingBrush);
        }
        catch (Exception ex)
        {
            DiscardPreparedUpdate(prepared);
            NativeLog.Write($"Native update failed: {ex}");
            UpdateButton.Content = $"Retry {release.Version}";
            SetStatus($"Native update failed: {ex.Message}", ErrorBrush);
        }
        finally
        {
            _updateInstallCancellation.Dispose();
            _updateInstallCancellation = null;
            _updateInProgress = false;
        }
    }

    private async Task WaitForUpdateDrainAsync(CancellationToken cancellationToken)
    {
        var consecutiveClearChecks = 0;
        while (consecutiveClearChecks < 2)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var sessions = await NativeUpdateDataServiceRecovery.RunAsync(
                token => _api.GetSessionsAsync(token),
                async token =>
                {
                    NativeLog.Write(
                        $"Dashboard service on port {_api.ConnectedPort} stopped during update drain; attempting recovery.");
                    SetStatus("Update downloaded · reconnecting to verify active sessions…", StartingBrush);
                    return await EnsureDashboardServiceAsync(token);
                },
                cancellationToken);
            var blockingSessions = NativeUpdatePolicy.CountBlockingSessions(
                sessions.Select(session => (session.Status, session.IsHeadless)));
            var localShells = _openTabs.Values.Count(state =>
                state.Kind == TerminalSessionKind.LocalShell && state.IsRunning);
            if (blockingSessions == 0 && localShells == 0)
            {
                consecutiveClearChecks++;
                if (consecutiveClearChecks < 2)
                {
                    SetStatus("Sessions are drained · confirming update handoff…", StartingBrush);
                    await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
                }
                continue;
            }

            consecutiveClearChecks = 0;
            var details = new List<string>();
            if (blockingSessions > 0) details.Add($"{blockingSessions} active Codex session(s)");
            if (localShells > 0) details.Add($"{localShells} local shell tab(s) to close");
            UpdateButton.Content = "Cancel update";
            SetStatus($"Update ready · waiting for {string.Join(" and ", details)}", StartingBrush);
            await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
        }
    }

    private static void DiscardPreparedUpdate(PreparedNativeUpdate? prepared)
    {
        if (prepared is null) return;
        try { Directory.Delete(prepared.StagingDirectory, recursive: true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private async void OnLaunchBrowserClicked(object? sender, RoutedEventArgs e)
    {
        try
        {
            LaunchBrowserButton.IsEnabled = false;
            var dashboardUrl = await FindBrowserDashboardUrlAsync();
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(dashboardUrl)
            {
                UseShellExecute = true,
            });
            SetStatus($"Opened browser-based {CurrentProviderLabel} dashboard", RunningBrush);
        }
        catch (Exception ex)
        {
            SetStatus($"Could not open browser dashboard: {ex.Message}", ErrorBrush);
        }
        finally
        {
            LaunchBrowserButton.IsEnabled = true;
        }
    }

    private static async Task<string> FindBrowserDashboardUrlAsync()
    {
        foreach (var dashboardUrl in BrowserDashboardUrls)
        {
            try
            {
                using var response = await BrowserDashboardProbeClient.GetAsync(
                    $"{dashboardUrl}/api/native/launch/status");
                if (!response.IsSuccessStatusCode
                    || !string.Equals(
                        response.Content.Headers.ContentType?.MediaType,
                        "application/json",
                        StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                var payload = await response.Content.ReadAsStringAsync();
                if (payload.Contains("\"ok\":true", StringComparison.OrdinalIgnoreCase))
                {
                    return dashboardUrl;
                }
            }
            catch
            {
                // Try the next known local browser-dashboard port.
            }
        }
        return BrowserDashboardUrls[0];
    }

    private async void OnThemeChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (_initializingSelectors || ThemeComboBox.SelectedIndex < 0)
        {
            return;
        }
        var theme = DashboardTheme.All[ThemeComboBox.SelectedIndex];
        ApplyTheme(theme);
        _settings = _settings with { StyleId = theme.Id };
        await PersistSettingsAsync();
    }

    private async void OnTextSizeChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (_initializingSelectors || TextSizeComboBox.SelectedIndex < 0)
        {
            return;
        }
        var size = DashboardTextSize.All[TextSizeComboBox.SelectedIndex];
        ApplyTextSize(size);
        _settings = _settings with { TextSizeId = size.Id };
        await PersistSettingsAsync();
    }

    private void ApplyTheme(DashboardTheme theme)
    {
        _currentTheme = theme;
        Resources["BaseBrush"] = Brush.Parse(theme.Base);
        Resources["SurfaceBrush"] = Brush.Parse(theme.Surface);
        Resources["ElevatedBrush"] = Brush.Parse(theme.Elevated);
        Resources["HoverBrush"] = Brush.Parse(theme.Hover);
        Resources["BorderBrush"] = Brush.Parse(theme.Border);
        Resources["BorderBrightBrush"] = Brush.Parse(theme.BorderBright);
        Resources["PrimaryBrush"] = Brush.Parse(theme.Primary);
        Resources["SecondaryBrush"] = Brush.Parse(theme.Secondary);
        Resources["MutedBrush"] = Brush.Parse(theme.Muted);
        Resources["AccentBrush"] = Brush.Parse(theme.Accent);
        Resources["TerminalBrush"] = Brush.Parse(theme.Terminal);
        var divider = Color.Parse(theme.BorderBright);
        Resources["SessionDividerBrush"] = new SolidColorBrush(
            Color.FromArgb(72, divider.R, divider.G, divider.B));
        _sessionDividerAccent = Color.Parse(theme.Accent);
        _sessionDividerSecondary = Color.Parse(theme.Secondary);
        Resources["TabIdleBrush"] = new SolidColorBrush(Color.FromArgb(
            20, _sessionDividerAccent.R, _sessionDividerAccent.G, _sessionDividerAccent.B));
        Resources["TabActiveBrush"] = new SolidColorBrush(Color.FromArgb(
            48, _sessionDividerAccent.R, _sessionDividerAccent.G, _sessionDividerAccent.B));
        Resources["TabDividerBrush"] = new SolidColorBrush(Color.FromArgb(
            85, divider.R, divider.G, divider.B));
        UpdateSessionHoverOverlayBrushes();
        UpdateHeaderConnectionIndicator();
        ApplyWindowsTitleBarTheme(theme);
        Resources["ScrollBarBackground"] = Brush.Parse(theme.Elevated);
        Resources["ScrollBarForeground"] = Brush.Parse(theme.Secondary);
        Resources["ScrollBarBorderBrush"] = Brush.Parse(theme.Border);
        Resources["ScrollBarPanningThumbBackground"] = Brush.Parse(theme.BorderBright);
        Resources["ScrollBarThumbBackgroundColor"] = Brush.Parse(theme.BorderBright);
        Resources["ScrollBarThumbFillPointerOver"] = Brush.Parse(theme.Accent);
        Resources["ScrollBarThumbFillPressed"] = Brush.Parse(theme.Accent);
        Resources["ScrollBarThumbFillDisabled"] = Brush.Parse(theme.Muted);
        Resources["ScrollBarTrackFill"] = Brush.Parse(theme.Elevated);
        Resources["ScrollBarTrackStroke"] = Brush.Parse(theme.Border);
        Resources["ScrollBarBackgroundPointerOver"] = Brush.Parse(theme.Hover);
        Resources["ScrollBarTrackFillPointerOver"] = Brush.Parse(theme.Elevated);
        Resources["ScrollBarTrackStrokePointerOver"] = Brush.Parse(theme.BorderBright);
        Resources["ScrollBarButtonArrowForeground"] = Brush.Parse(theme.Secondary);
        Resources["ScrollBarButtonArrowForegroundPointerOver"] = Brush.Parse(theme.Accent);
        Resources["ScrollBarButtonArrowForegroundPressed"] = Brush.Parse(theme.Primary);
        Resources["ScrollBarButtonArrowForegroundDisabled"] = Brush.Parse(theme.Muted);
        Resources["ScrollBarButtonBackground"] = Brushes.Transparent;
        Resources["ScrollBarButtonBackgroundPointerOver"] = Brush.Parse(theme.Hover);
        Resources["ScrollBarButtonBackgroundPressed"] = Brush.Parse(theme.BorderBright);
        Resources["ScrollBarButtonBackgroundDisabled"] = Brushes.Transparent;
        Resources["ScrollBarButtonBorderBrush"] = Brushes.Transparent;
        Resources["ScrollBarButtonBorderBrushPointerOver"] = Brush.Parse(theme.Accent);
        Resources["ScrollBarButtonBorderBrushPressed"] = Brush.Parse(theme.Primary);
        Resources["ScrollBarButtonBorderBrushDisabled"] = Brushes.Transparent;
        if (Application.Current is not null)
        {
            Application.Current.RequestedThemeVariant = theme.IsLight ? ThemeVariant.Light : ThemeVariant.Dark;
        }
        foreach (var pane in _panes)
            ApplyPaneTheme(pane);
        PaneWorkspaceScroll.Background = Brush.Parse(theme.Base);
        PaneHost.Background = Brush.Parse(theme.Base);
        foreach (var paneSplitter in _paneSplitters)
        {
            paneSplitter.Background = Brush.Parse(theme.Border);
        }
        foreach (var tab in _previewTabs.Values)
        {
            var previewTheme = _previewPaneByTab.TryGetValue(tab, out var previewPane)
                ? EffectivePaneTheme(previewPane)
                : theme;
            if (tab.Header is StackPanel header)
            {
                if (header.Children.ElementAtOrDefault(0) is TextBlock icon) icon.Foreground = Brush.Parse(previewTheme.Accent);
                if (header.Children.ElementAtOrDefault(1) is TextBlock title) title.Foreground = Brush.Parse(previewTheme.Primary);
            }
            if (tab.Content is SessionPreviewControl preview) _ = preview.ReloadAsync();
        }
        if (_stats is not null)
        {
            RenderStats(_stats);
        }
    }

    private static void ApplyThemeToSessionState(SessionTabState state, DashboardTheme theme)
    {
        var terminal = Brush.Parse(theme.Terminal);
        var surface = Brush.Parse(theme.Surface);
        var border = Brush.Parse(theme.Border);
        var primary = Brush.Parse(theme.Primary);
        var secondary = Brush.Parse(theme.Secondary);
        var accent = Brush.Parse(theme.Accent);
        state.Terminal.Background = terminal;
        state.Terminal.Foreground = primary;
        state.TerminalViewport.Background = terminal;
        state.ScreenshotButton.Background = Brush.Parse(theme.Elevated);
        state.ScreenshotButton.BorderBrush = Brush.Parse(theme.BorderBright);
        state.ScreenshotButton.Foreground = primary;
        ApplyAdaptiveToggleTheme(state, theme);
        state.AdaptiveComposer.Background = surface;
        state.AdaptiveComposer.BorderBrush = accent;
        state.AdaptivePromptBox.Background = Brush.Parse(theme.Elevated);
        state.AdaptivePromptBox.BorderBrush = Brush.Parse(theme.BorderBright);
        state.AdaptivePromptBox.Foreground = primary;
        state.AdaptiveSendButton.Background = Brush.Parse(theme.Elevated);
        state.AdaptiveSendButton.BorderBrush = accent;
        state.AdaptiveSendButton.Foreground = primary;
        state.AdaptiveRouteText.Foreground = secondary;
        state.MutedTextColor = Color.Parse(theme.Muted);

        // TerminalControl's template owns the actual drawing surface. Updating the
        // wrapper alone does not reliably push a new background into an already
        // materialized TerminalView, and its cached text runs retain the old brush.
        var terminalView = state.Terminal
            .GetVisualDescendants()
            .OfType<TerminalView>()
            .FirstOrDefault();
        if (terminalView is not null)
        {
            terminalView.Background = terminal;
            terminalView.Foreground = primary;
            terminalView.CursorColor = Color.Parse(theme.Accent);
            var lines = state.Terminal.Terminal.Buffer.Lines;
            for (var index = 0; index < lines.Length; index++)
            {
                if (lines[index] is { } line) line.Cache = null;
            }
        }
        RestyleTerminalText(state);
        state.Inspector.Background = surface;
        state.Inspector.BorderBrush = border;
        state.InspectorHeading.Foreground = secondary;
        state.InspectorToggleButton.Background = Brush.Parse(theme.Elevated);
        state.InspectorToggleButton.BorderBrush = Brush.Parse(theme.BorderBright);
        state.InspectorToggleButton.Foreground = primary;
        state.InspectorResizeTrack.Background = surface;
        state.InspectorResizeTrack.BorderBrush = Brush.Parse(theme.BorderBright);
        state.InspectorResizeGrip.Background = accent;
        state.ReconnectBanner.Background = Brush.Parse(theme.Elevated);
        state.ReconnectBanner.BorderBrush = Brush.Parse(theme.BorderBright);
        state.ReconnectText.Foreground = primary;
        state.RestoreOverlay.Background = terminal;
        state.RestoreOverlay.BorderBrush = Brush.Parse(theme.BorderBright);
        state.RestoreText.Foreground = primary;
        state.TitleBlock.Foreground = primary;
        state.RenameBox.Background = Brush.Parse(theme.Elevated);
        state.RenameBox.BorderBrush = Brush.Parse(theme.BorderBright);
        state.RenameBox.Foreground = primary;
        foreach (var action in new[]
                 {
                     state.RenameButton,
                     state.SummaryButton,
                     state.ArchiveButton,
                     state.StopButton,
                     state.ReconnectButton,
                 })
        {
            action.Background = Brush.Parse(theme.Elevated);
            action.BorderBrush = Brush.Parse(theme.BorderBright);
            action.Foreground = primary;
        }
        if (state.ArchiveConfirmationPending) state.ArchiveButton.Foreground = ErrorBrush;
        state.ContextText.Foreground = secondary;
        state.ContextBar.Background = Brush.Parse(theme.Elevated);
        state.ContextBar.Foreground = accent;
        state.ConfigText.Foreground = secondary;
        state.PromptText.Foreground = secondary;
        ApplyScopedScrollbarTheme(state.Terminal, theme);
        ApplyScopedScrollbarTheme(state.InspectorBody, theme);
        foreach (var heading in state.DetailHeadings) heading.Foreground = accent;
        state.ContextDonut.SegmentBrushes =
        [
            Brush.Parse("#38BDF8"), Brush.Parse("#8B5CF6"), accent,
            StartingBrush, ErrorBrush, Brush.Parse(theme.BorderBright)
        ];
        state.ContextDonut.InvalidateVisual();
        terminalView?.InvalidateVisual();
        state.Terminal.InvalidateVisual();
        state.TerminalViewport.InvalidateVisual();
        state.Inspector.InvalidateVisual();
    }

    private static void ApplyAdaptiveToggleTheme(SessionTabState state, DashboardTheme theme)
    {
        var enabled = IsCodexSession(state) && state.Pane.AdaptiveEnabled;
        var elevated = Brush.Parse(theme.Elevated);
        var hover = Brush.Parse(theme.Hover);
        var borderBright = Brush.Parse(theme.BorderBright);
        var primary = Brush.Parse(theme.Primary);
        var accent = Brush.Parse(theme.Accent);

        // Checked and pointer-over ToggleButton styles resolve these resources
        // from the control, keeping their chrome scoped to the terminal pane.
        state.AdaptiveToggleButton.Resources["ElevatedBrush"] = elevated;
        state.AdaptiveToggleButton.Resources["HoverBrush"] = hover;
        state.AdaptiveToggleButton.Resources["BorderBrightBrush"] = borderBright;
        state.AdaptiveToggleButton.Resources["PrimaryBrush"] = primary;
        state.AdaptiveToggleButton.Resources["AccentBrush"] = accent;
        state.AdaptiveToggleButton.Background = enabled ? hover : elevated;
        state.AdaptiveToggleButton.BorderBrush = enabled ? accent : borderBright;
        state.AdaptiveToggleButton.BorderThickness = new Thickness(enabled ? 2 : 1);
        state.AdaptiveToggleButton.Foreground = enabled ? accent : primary;
        state.AdaptivePulseHalo.BorderBrush = accent;
        state.AdaptivePulseHalo.IsVisible = enabled;
        if (!enabled) state.AdaptivePulseHalo.Opacity = 0;
    }

    private static void ApplyScopedScrollbarTheme(Control scope, DashboardTheme theme)
    {
        // The window-level ScrollBar styles use the dashboard palette keys for
        // their normal, pointer-over, expanded, and pressed states. Keep those
        // keys in the pane's resource scope as well as Fluent's scrollbar keys;
        // otherwise the template-specific brushes change while our style
        // setters continue resolving colors from the dashboard theme.
        scope.Resources["BaseBrush"] = Brush.Parse(theme.Base);
        scope.Resources["SurfaceBrush"] = Brush.Parse(theme.Surface);
        scope.Resources["ElevatedBrush"] = Brush.Parse(theme.Elevated);
        scope.Resources["HoverBrush"] = Brush.Parse(theme.Hover);
        scope.Resources["BorderBrush"] = Brush.Parse(theme.Border);
        scope.Resources["BorderBrightBrush"] = Brush.Parse(theme.BorderBright);
        scope.Resources["PrimaryBrush"] = Brush.Parse(theme.Primary);
        scope.Resources["SecondaryBrush"] = Brush.Parse(theme.Secondary);
        scope.Resources["MutedBrush"] = Brush.Parse(theme.Muted);
        scope.Resources["AccentBrush"] = Brush.Parse(theme.Accent);
        scope.Resources["TerminalBrush"] = Brush.Parse(theme.Terminal);
        scope.Resources["ScrollBarBackground"] = Brush.Parse(theme.Elevated);
        scope.Resources["ScrollBarForeground"] = Brush.Parse(theme.Secondary);
        scope.Resources["ScrollBarBorderBrush"] = Brush.Parse(theme.Border);
        scope.Resources["ScrollBarPanningThumbBackground"] = Brush.Parse(theme.BorderBright);
        scope.Resources["ScrollBarThumbBackgroundColor"] = Brush.Parse(theme.BorderBright);
        scope.Resources["ScrollBarThumbFillPointerOver"] = Brush.Parse(theme.Accent);
        scope.Resources["ScrollBarThumbFillPressed"] = Brush.Parse(theme.Accent);
        scope.Resources["ScrollBarThumbFillDisabled"] = Brush.Parse(theme.Muted);
        scope.Resources["ScrollBarTrackFill"] = Brush.Parse(theme.Elevated);
        scope.Resources["ScrollBarTrackStroke"] = Brush.Parse(theme.Border);
        scope.Resources["ScrollBarBackgroundPointerOver"] = Brush.Parse(theme.Hover);
        scope.Resources["ScrollBarTrackFillPointerOver"] = Brush.Parse(theme.Elevated);
        scope.Resources["ScrollBarTrackStrokePointerOver"] = Brush.Parse(theme.BorderBright);
        scope.Resources["ScrollBarButtonArrowForeground"] = Brush.Parse(theme.Secondary);
        scope.Resources["ScrollBarButtonArrowForegroundPointerOver"] = Brush.Parse(theme.Accent);
        scope.Resources["ScrollBarButtonArrowForegroundPressed"] = Brush.Parse(theme.Primary);
        scope.Resources["ScrollBarButtonArrowForegroundDisabled"] = Brush.Parse(theme.Muted);
        scope.Resources["ScrollBarButtonBackground"] = Brushes.Transparent;
        scope.Resources["ScrollBarButtonBackgroundPointerOver"] = Brush.Parse(theme.Hover);
        scope.Resources["ScrollBarButtonBackgroundPressed"] = Brush.Parse(theme.BorderBright);
        scope.Resources["ScrollBarButtonBackgroundDisabled"] = Brushes.Transparent;
        scope.Resources["ScrollBarButtonBorderBrush"] = Brushes.Transparent;
        scope.Resources["ScrollBarButtonBorderBrushPointerOver"] = Brush.Parse(theme.Accent);
        scope.Resources["ScrollBarButtonBorderBrushPressed"] = Brush.Parse(theme.Primary);
        scope.Resources["ScrollBarButtonBorderBrushDisabled"] = Brushes.Transparent;
        foreach (var scrollbar in scope.GetVisualDescendants().OfType<ScrollBar>())
            scrollbar.InvalidateVisual();
    }

    private void ApplyTextSize(DashboardTextSize size)
    {
        FontSize = 13 * size.Scale;
        foreach (var state in _openTabs.Values)
        {
            state.Terminal.FontSize = size.TerminalFontSize;
        }
        foreach (var pane in _panes)
            foreach (var tab in pane.Tabs.Items.OfType<TabItem>()) ApplyTabHeaderTextSize(tab, size);
    }

    private static void ApplyTabHeaderTextSize(TabItem tab, DashboardTextSize size)
    {
        if (tab.Header is TextBlock single)
        {
            single.FontSize = TabHeaderFontSize(size);
            return;
        }
        if (tab.Header is not StackPanel header) return;
        var textBlocks = header.Children.OfType<TextBlock>().ToList();
        if (textBlocks.ElementAtOrDefault(0) is TextBlock icon) icon.FontSize = TabIconFontSize(size);
        if (textBlocks.ElementAtOrDefault(1) is TextBlock title) title.FontSize = TabHeaderFontSize(size);
        foreach (var editor in header.Children.OfType<TextBox>()) editor.FontSize = TabHeaderFontSize(size);
        foreach (var close in header.Children.OfType<Button>()) close.FontSize = TabCloseFontSize(size);
    }

    private static double TabHeaderFontSize(DashboardTextSize size) => size.Id switch
    {
        "large" => 14,
        "xl" => 16,
        "xxl" => 18,
        _ => 12,
    };

    private static double TabIconFontSize(DashboardTextSize size) => TabHeaderFontSize(size) - 2;
    private static double TabCloseFontSize(DashboardTextSize size) => Math.Max(11, TabHeaderFontSize(size) - 2);

    private void AttachTerminalVisualStyling(SessionTabState state)
    {
        if (state.TerminalView is not null) return;
        var terminalView = state.Terminal
            .GetVisualDescendants()
            .OfType<TerminalView>()
            .FirstOrDefault();
        if (terminalView is null) return;

        state.TerminalView = terminalView;
        terminalView.CursorBlink = false;
        terminalView.Terminal.Options.CursorBlink = false;
        terminalView.AddHandler(
            InputElement.PointerPressedEvent,
            (_, args) => OnTerminalLinkPointerPressed(state, args),
            RoutingStrategies.Tunnel,
            handledEventsToo: true);
        terminalView.Terminal.CursorStyleChanged += (_, _) =>
            Dispatcher.UIThread.Post(() =>
            {
                terminalView.CursorBlink = false;
                terminalView.Terminal.Options.CursorBlink = false;
            });
        terminalView.PropertyChanged += (_, args) =>
        {
            if (args.Property == TerminalView.ViewportYProperty)
            {
                Dispatcher.UIThread.Post(() => RestyleTerminalText(state));
            }
        };
        terminalView.Terminal.BufferChanged += (_, _) =>
            Dispatcher.UIThread.Post(() =>
            {
                terminalView.CursorBlink = false;
                terminalView.Terminal.Options.CursorBlink = false;
                state.TerminalStartupGate?.ObserveOutput(DateTimeOffset.UtcNow);
                if (state.TerminalStartupGate is null) RestyleTerminalText(state);
            });
        RestyleTerminalText(state);
    }

    private void OnTerminalLinkPointerPressed(SessionTabState state, PointerPressedEventArgs args)
    {
        if (state.TerminalView is not { } terminalView
            || (args.KeyModifiers & (OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control)) == 0
            || args.GetCurrentPoint(terminalView).Properties.PointerUpdateKind
                is not PointerUpdateKind.LeftButtonPressed)
        {
            return;
        }

        var terminal = terminalView.Terminal;
        if (terminal.Cols <= 0 || terminal.Rows <= 0
            || terminalView.Bounds.Width <= 0 || terminalView.Bounds.Height <= 0) return;
        var point = args.GetPosition(terminalView);
        var column = Math.Clamp((int)(point.X / (terminalView.Bounds.Width / terminal.Cols)), 0, terminal.Cols - 1);
        var viewportRow = Math.Clamp((int)(point.Y / (terminalView.Bounds.Height / terminal.Rows)), 0, terminal.Rows - 1);
        var lineIndex = terminal.Buffer.ViewportY + viewportRow;
        if (lineIndex < 0 || lineIndex >= terminal.Buffer.Length) return;
        var line = terminal.Buffer.GetLine(lineIndex);
        if (line is null) return;
        var url = TerminalLinkDetector.FindHttpUrlAtColumn(line.TranslateToString(trimRight: false), column);
        if (url is null) return;

        args.Handled = true;
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url)
            {
                UseShellExecute = true,
            });
            SetStatus($"Opened {new Uri(url).Host} in the default browser", RunningBrush);
        }
        catch (Exception ex)
        {
            SetStatus($"Could not open link: {ex.Message}", ErrorBrush);
        }
    }

    private static bool IsCodexComposerReady(SessionTabState state)
    {
        var terminal = state.TerminalView?.Terminal;
        if (terminal is null) return false;

        var buffer = terminal.Buffer;
        var lines = buffer.Lines;
        var firstLine = Math.Max(0, buffer.ViewportY);
        var lastLine = Math.Min(lines.Length, firstLine + buffer.Rows);
        var bottomLines = new List<string>(10);
        for (var index = Math.Max(firstLine, lastLine - 10); index < lastLine; index++)
        {
            if (lines[index] is { } line) bottomLines.Add(line.TranslateToString(trimRight: true));
        }

        return CodexTerminalReadiness.HasComposer(
            terminal.CursorVisible,
            buffer.Y,
            buffer.Rows,
            bottomLines);
    }

    private static void RestyleTerminalText(SessionTabState state)
    {
        var terminalView = state.TerminalView;
        if (terminalView is null) return;

        var color = state.MutedTextColor;
        var packedRgb = color.R << 16 | color.G << 8 | color.B;
        var buffer = terminalView.Terminal.Buffer;
        var lines = buffer.Lines;
        var firstLine = Math.Max(0, buffer.ViewportY);
        var lastLine = Math.Min(lines.Length, firstLine + buffer.Rows);
        for (var lineIndex = firstLine; lineIndex < lastLine; lineIndex++)
        {
            if (lines[lineIndex] is not { } line) continue;
            var links = TerminalLinkDetector.FindHttpUrls(line.TranslateToString(trimRight: false));
            var changed = false;
            for (var cellIndex = 0; cellIndex < line.Length; cellIndex++)
            {
                var cell = line[cellIndex];
                var attributes = cell.Attributes;
                var changedCell = false;
                if (attributes.IsBlink())
                {
                    attributes.SetBlink(false);
                    changedCell = true;
                }
                if (attributes.IsDim()
                    && (attributes.GetFgColorMode() != (int)XTerm.Common.ColorMode.RGB
                        || attributes.GetFgColor() != packedRgb
                        || attributes.IsBold()))
                {
                    attributes.SetFgColor(packedRgb, (int)XTerm.Common.ColorMode.RGB);
                    attributes.SetBold(false);
                    changedCell = true;
                }
                if (!attributes.IsUnderline()
                    && links.Any(link => cellIndex >= link.Start && cellIndex < link.Start + link.Length))
                {
                    attributes.SetUnderline(true);
                    changedCell = true;
                }
                if (!changedCell) continue;
                cell.Attributes = attributes;
                line[cellIndex] = cell;
                changed = true;
            }
            if (changed) line.Cache = null;
        }
        terminalView.InvalidateVisual();
    }

    private IBrush ResourceBrush(string name) => Resources.TryGetResource(name, ActualThemeVariant, out var value)
        && value is IBrush brush
            ? brush
            : Brushes.Transparent;

    private static string FormatNumber(long value) => value switch
    {
        >= 1_000_000_000 => $"{value / 1_000_000_000d:0.##}B",
        >= 1_000_000 => $"{value / 1_000_000d:0.##}M",
        >= 1_000 => $"{value / 1_000d:0.##}K",
        _ => value.ToString("N0"),
    };

    private static string CreditValue(UsageTotals usage)
    {
        if (usage.TotalTokens <= 0) return "0";
        if (usage.PricedTokens <= 0) return "—";
        return $"~{usage.EstimatedCredits:0.###}";
    }

    private static string CreditEstimate(UsageTotals usage)
    {
        if (usage.TotalTokens <= 0) return "0 credits";
        if (usage.PricedTokens <= 0) return "credit rate unavailable";
        var estimate = $"~{usage.EstimatedCredits:0.###} credits";
        return usage.PricingCoverage >= 0.9995
            ? estimate
            : $"{estimate} partial";
    }

    private static string PricingCoverageLabel(UsageTotals usage)
    {
        if (usage.TotalTokens <= 0) return "no token usage";
        return usage.PricedTokens <= 0
            ? "0% priced · model rate unpublished"
            : $"{usage.PricingCoverage:P0} pricing coverage";
    }

    private static string FormatDuration(long seconds)
    {
        var duration = TimeSpan.FromSeconds(Math.Max(0, seconds));
        if (duration.TotalDays >= 1) return $"{(int)duration.TotalDays}d {duration.Hours}h";
        if (duration.TotalHours >= 1) return $"{(int)duration.TotalHours}h {duration.Minutes}m";
        if (duration.TotalMinutes >= 1) return $"{(int)duration.TotalMinutes}m";
        return $"{Math.Max(0, seconds)}s";
    }

    private async void OnRefreshTimerTick(object? sender, EventArgs e)
    {
        if (_serviceStopRequested) return;
        if (!await _api.IsAvailableAsync())
        {
            if (!await EnsureDashboardServiceAsync()) return;
        }
        if (_statusFeed is null) StartStatusFeed();
        await RefreshSessionsAsync();
        _refreshTick++;
        if (_refreshTick % 2 == 0)
        {
            try
            {
                var statsTask = _api.GetStatsAsync(_settings.StatsMode);
                var statusTask = _api.GetStatusAsync();
                await Task.WhenAll(statsTask, statusTask);
                _stats = statsTask.Result;
                _dashboardStatus = statusTask.Result;
                RenderStats(_stats);
                RenderProviderStatus(_dashboardStatus);
            }
            catch (Exception ex)
            {
                NativeLog.Write($"Stats refresh failed: {ex.Message}");
            }
        }
    }

    private async void OnWindowClosing(object? sender, WindowClosingEventArgs e)
    {
        if (OperatingSystem.IsMacOS() && !_shutdownConfirmed)
        {
            e.Cancel = true;
            if (_closePromptOpen) return;
            _closePromptOpen = true;
            await SaveWorkspaceAsync();
            _closePromptOpen = false;
            Hide();
            NativeLog.Write("Native window hidden; use the menu-bar icon to reopen or stop the local service.");
            return;
        }
        if (_shutdownConfirmed)
        {
            ShutdownNativeResources();
            return;
        }
        e.Cancel = true;
        if (_closePromptOpen) return;
        _closePromptOpen = true;
        await SaveWorkspaceAsync();
        _closePromptOpen = false;
        _shutdownConfirmed = true;
        Close();
    }

    public void ShowFromMenuBar()
    {
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }

    public async Task StartServiceFromMenuBarAsync()
    {
        _serviceStopRequested = false;
        await ReconcileDashboardRepositoryAsync();
        if (await EnsureDashboardServiceAsync())
        {
            await RefreshAllAsync();
            StartStatusFeed();
        }
        ShowFromMenuBar();
    }

    public async Task StopOwnedServiceFromMenuBarAsync()
    {
        var outcome = await TryStopOwnedServiceAsync(allowStopWhenProbeFails: false);
        if (outcome == OwnedServiceStopOutcome.Stopped)
        {
            SetStatus("Local dashboard service stopped. Use the menu-bar icon to start it.", StartingBrush);
            SessionCountText.Text = "Service stopped";
        }
        ShowFromMenuBar();
    }

    public async Task QuitFromMenuBarAsync()
    {
        if (_serviceManager.OwnsRunningService)
        {
            var outcome = await TryStopOwnedServiceAsync(allowStopWhenProbeFails: true);
            if (outcome == OwnedServiceStopOutcome.RefusedActiveTerminals) return;
        }
        _shutdownConfirmed = true;
        Close();
    }

    private enum OwnedServiceStopOutcome
    {
        Stopped,
        NotOwned,
        RefusedActiveTerminals,
        ProbeFailed,
        StopFailed,
        ProbeFailedBestEffort,
    }

    private async Task<OwnedServiceStopOutcome> TryStopOwnedServiceAsync(bool allowStopWhenProbeFails)
    {
        if (!_serviceManager.OwnsRunningService)
        {
            SetStatus("This UI is connected to an existing service and cannot stop it.", StartingBrush);
            return OwnedServiceStopOutcome.NotOwned;
        }

        var probeFailed = false;
        try
        {
            var active = await _api.GetActiveTerminalIdsAsync();
            if (active.Count > 0)
            {
                SetStatus(
                    $"Close {active.Count} active terminal{(active.Count == 1 ? string.Empty : "s")} before stopping the service.",
                    StartingBrush);
                return OwnedServiceStopOutcome.RefusedActiveTerminals;
            }
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Could not verify active terminals before stopping service: {ex}");
            if (!allowStopWhenProbeFails)
            {
                SetStatus("Could not verify active terminals; the service was not stopped.", ErrorBrush);
                return OwnedServiceStopOutcome.ProbeFailed;
            }
            probeFailed = true;
            NativeLog.Write("Proceeding with best-effort service stop because terminal probe failed during quit.");
        }

        if (!_serviceManager.StopOwnedService())
        {
            if (_serviceManager.OwnsRunningService)
            {
                SetStatus(
                    "Could not fully stop the local dashboard service; ownership kept for retry.",
                    ErrorBrush);
            }
            else if (!probeFailed)
            {
                SetStatus("No native-managed service is running.", StartingBrush);
            }
            return probeFailed
                ? OwnedServiceStopOutcome.ProbeFailedBestEffort
                : OwnedServiceStopOutcome.StopFailed;
        }

        _serviceStopRequested = true;
        if (_statusFeed is not null)
        {
            await _statusFeed.DisposeAsync();
            _statusFeed = null;
        }
        return probeFailed
            ? OwnedServiceStopOutcome.ProbeFailedBestEffort
            : OwnedServiceStopOutcome.Stopped;
    }

    private void ShutdownNativeResources()
    {
        _refreshTimer.Stop();
        _connectionPulseTimer.Stop();
        _sessionHoverAnimationTimer.Stop();
        _updateCheckTimer.Stop();
        if (_statusFeed is not null) _ = _statusFeed.DisposeAsync();
        _searchCancellation?.Cancel();
        _updateInstallCancellation?.Cancel();
        foreach (var state in _openTabs.Values.ToList())
        {
            CancelTerminalReconnect(state, suppress: true);
            EndTerminalStartupReveal(state);
            state.Terminal.Kill();
        }
        _serviceManager.Dispose();
        _updateService.Dispose();
        _api.Dispose();
    }

    private void SetStatus(string message, IBrush brush)
    {
        if (!Dispatcher.UIThread.CheckAccess())
        {
            Dispatcher.UIThread.Post(() => SetStatus(message, brush));
            return;
        }
        StatusText.Text = message;
        StatusDot.Fill = brush;
    }

    private void SetDashboardConnectionState(bool connected)
    {
        if (!Dispatcher.UIThread.CheckAccess())
        {
            Dispatcher.UIThread.Post(() => SetDashboardConnectionState(connected));
            return;
        }
        _isDashboardConnected = connected;
        UpdateHeaderConnectionIndicator();
    }

    private void UpdateHeaderConnectionIndicator()
    {
        var brush = _isDashboardConnected ? ResourceBrush("AccentBrush") : ErrorBrush;
        HeaderStatusDot.Fill = brush;
        HeaderStatusHalo.Fill = brush;
        var label = _isDashboardConnected ? "Dashboard connected" : "Dashboard disconnected";
        ToolTip.SetTip(HeaderConnectionIndicator, label);
        AutomationProperties.SetName(HeaderConnectionIndicator, label);
        AutomationProperties.SetName(HomeButton, $"{CurrentProviderLabel.ToUpperInvariant()} NATIVE DASHBOARD");
        AutomationProperties.SetHelpText(HomeButton, $"{label}. Go to dashboard.");
    }

    private void OnConnectionPulseTick(object? sender, EventArgs e)
    {
        var elapsedSeconds = (DateTimeOffset.UtcNow - _connectionPulseStartedAt).TotalSeconds;
        var intensity = (Math.Cos(elapsedSeconds / 2.4 * Math.PI * 2) + 1) / 2;
        HeaderStatusDot.Opacity = 0.42 + intensity * 0.58;
        HeaderStatusHalo.Opacity = 0.08 + intensity * 0.2;
        foreach (var state in _openTabs.Values)
        {
            if (!state.AdaptivePulseHalo.IsVisible) continue;
            state.AdaptivePulseHalo.Opacity = 0.12 + intensity * 0.38;
        }
    }

    private void ApplyWindowsTitleBarTheme(DashboardTheme theme) =>
        ApplyWindowsTitleBarTheme(this, theme);

    private static void ApplyWindowsTitleBarTheme(Window window, DashboardTheme theme)
    {
        var handle = window.TryGetPlatformHandle();
        if (handle is null) return;
        WindowsTitleBarTheme.Apply(
            handle.Handle,
            Color.Parse(theme.Surface),
            Color.Parse(theme.Primary),
            Color.Parse(theme.BorderBright),
            !theme.IsLight);
    }

    private void OnSessionRowPointerEntered(object? sender, PointerEventArgs e)
    {
        if (sender is not Grid row) return;
        if (ReferenceEquals(row, _hoveredSessionRow)) return;
        _hoveredSessionRow = row;
        _sessionHoverAnimationStartedAt = DateTimeOffset.UtcNow;
        SessionHoverOverlay.Opacity = 1;
        PositionSessionHoverOverlay();
        UpdateSessionHoverAnimation();
        _sessionHoverAnimationTimer.Start();
    }

    private void OnSessionRowPointerExited(object? sender, PointerEventArgs e)
    {
        if (sender is not Grid row || !ReferenceEquals(row, _hoveredSessionRow)) return;
        ClearSessionHoverOverlay();
    }

    private void OnSessionHoverAnimationTick(object? sender, EventArgs e)
    {
        if (_hoveredSessionRow is null)
        {
            _sessionHoverAnimationTimer.Stop();
            return;
        }
        PositionSessionHoverOverlay();
        UpdateSessionHoverAnimation();
    }

    private void PositionSessionHoverOverlay()
    {
        if (_hoveredSessionRow is null) return;
        var origin = _hoveredSessionRow.TranslatePoint(new Point(0, 0), SessionHoverOverlay);
        if (origin is null) return;

        var overlayWidth = SessionHoverOverlay.Bounds.Width;
        var top = origin.Value.Y;
        var bottom = top + _hoveredSessionRow.Bounds.Height - 1;
        if (overlayWidth <= 0 || bottom < 0 || top > SessionHoverOverlay.Bounds.Height)
        {
            ClearSessionHoverOverlay();
            return;
        }

        var bandWidth = Math.Clamp(overlayWidth * 0.34, 110, 230);
        SessionHoverTopBaseLine.Width = overlayWidth;
        SessionHoverBottomBaseLine.Width = overlayWidth;
        SessionHoverTopBand.Width = bandWidth;
        SessionHoverBottomBand.Width = bandWidth;
        Canvas.SetLeft(SessionHoverTopBaseLine, 0);
        Canvas.SetLeft(SessionHoverBottomBaseLine, 0);
        Canvas.SetLeft(SessionHoverTopBand, 0);
        Canvas.SetLeft(SessionHoverBottomBand, 0);
        Canvas.SetTop(SessionHoverTopBaseLine, top);
        Canvas.SetTop(SessionHoverTopBand, top);
        Canvas.SetTop(SessionHoverBottomBaseLine, bottom);
        Canvas.SetTop(SessionHoverBottomBand, bottom);
    }

    private void UpdateSessionHoverAnimation()
    {
        var elapsed = (DateTimeOffset.UtcNow - _sessionHoverAnimationStartedAt).TotalSeconds;
        var phase = (elapsed % 3.2) / 3.2;
        var travel = SessionHoverOverlay.Bounds.Width + SessionHoverTopBand.Width;
        var x = -SessionHoverTopBand.Width + phase * travel;
        _sessionHoverTopTransform.X = x;
        _sessionHoverBottomTransform.X = x;
    }

    private void UpdateSessionHoverOverlayBrushes()
    {
        var baseBrush = new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0, 0.5, RelativeUnit.Relative),
            EndPoint = new RelativePoint(1, 0.5, RelativeUnit.Relative),
            GradientStops = new GradientStops
            {
                new(Color.FromArgb(28, _sessionDividerSecondary.R, _sessionDividerSecondary.G, _sessionDividerSecondary.B), 0),
                new(Color.FromArgb(95, _sessionDividerSecondary.R, _sessionDividerSecondary.G, _sessionDividerSecondary.B), 0.5),
                new(Color.FromArgb(28, _sessionDividerSecondary.R, _sessionDividerSecondary.G, _sessionDividerSecondary.B), 1),
            },
        };
        var bandBrush = new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0, 0.5, RelativeUnit.Relative),
            EndPoint = new RelativePoint(1, 0.5, RelativeUnit.Relative),
            GradientStops = new GradientStops
            {
                new(Color.FromArgb(0, _sessionDividerSecondary.R, _sessionDividerSecondary.G, _sessionDividerSecondary.B), 0),
                new(Color.FromArgb(205, _sessionDividerSecondary.R, _sessionDividerSecondary.G, _sessionDividerSecondary.B), 0.28),
                new(Color.FromArgb(250, _sessionDividerAccent.R, _sessionDividerAccent.G, _sessionDividerAccent.B), 0.65),
                new(Color.FromArgb(0, _sessionDividerAccent.R, _sessionDividerAccent.G, _sessionDividerAccent.B), 1),
            },
        };
        SessionHoverTopBaseLine.Background = baseBrush;
        SessionHoverBottomBaseLine.Background = baseBrush;
        SessionHoverTopBand.Background = bandBrush;
        SessionHoverBottomBand.Background = bandBrush;
    }

    private void ResetSessionDividerAnimations() => ClearSessionHoverOverlay();

    private void ClearSessionHoverOverlay()
    {
        _sessionHoverAnimationTimer.Stop();
        _hoveredSessionRow = null;
        SessionHoverOverlay.Opacity = 0;
    }

    private sealed record RepoFilter(string Label, string? WorkingDir)
    {
        public override string ToString() => Label;
    }

    private sealed record PaneThemeOption(string? Id, string Label)
    {
        public override string ToString() => Label;
    }

    private enum TerminalSessionKind
    {
        Codex,
        LocalShell,
    }

    private sealed class TerminalPaneState(
        string id,
        TabControl tabs,
        Grid root,
        Button addButton,
        Button? removeButton,
        Border? emptyState,
        Border activeBorder,
        double width,
        double inspectorHeight)
    {
        public string Id { get; } = id;
        public TabControl Tabs { get; } = tabs;
        public Grid Root { get; } = root;
        public Button AddButton { get; } = addButton;
        public Button? RemoveButton { get; } = removeButton;
        public Border? EmptyState { get; } = emptyState;
        public Border ActiveBorder { get; } = activeBorder;
        public TabItem? SessionLauncherTab { get; set; }
        public double Width { get; set; } = width;
        public double InspectorHeight { get; set; } = inspectorHeight;
        public bool InspectorCollapsed { get; set; }
        public bool AdaptiveEnabled { get; set; }
        public string AdaptivePreference { get; set; } = "balanced";
        public bool AdaptiveChanging { get; set; }
        public ComboBox? ThemeComboBox { get; set; }
        public string? StyleId { get; set; }
        public bool UpdatingThemeSelector { get; set; }
    }

    private sealed class SessionTabState(
        string key,
        TabItem tab,
        TerminalControl terminal,
        Grid terminalViewport,
        Button screenshotButton,
        ToggleButton adaptiveToggleButton,
        Border adaptivePulseHalo,
        Border adaptiveComposer,
        TextBox adaptivePromptBox,
        Button adaptiveSendButton,
        TextBlock adaptiveRouteText,
        Border inspector,
        ScrollViewer inspectorBody,
        TextBlock inspectorHeading,
        Button inspectorToggleButton,
        Border inspectorSplitter,
        Border inspectorResizeTrack,
        Border inspectorResizeGrip,
        Border reconnectBanner,
        TextBlock reconnectText,
        Button reconnectButton,
        Border restoreOverlay,
        TextBlock restoreText,
        TextBlock titleBlock,
        TextBlock statusGlyph,
        TextBlock contextText,
        ProgressBar contextBar,
        ContextDonutControl contextDonut,
        IReadOnlyList<TextBlock> detailHeadings,
        TextBlock configText,
        TextBlock promptText,
        TextBox renameBox,
        Button renameButton,
        Button archiveButton,
        Button summaryButton,
        Button stopButton,
        string workingDirectory,
        DashboardSession? session,
        TerminalSessionKind kind,
        TerminalPaneState pane,
        string providerId)
    {
        public string Key { get; set; } = key;
        public TabItem Tab { get; } = tab;
        public TerminalControl Terminal { get; } = terminal;
        public Grid TerminalViewport { get; } = terminalViewport;
        public Button ScreenshotButton { get; } = screenshotButton;
        public ToggleButton AdaptiveToggleButton { get; } = adaptiveToggleButton;
        public Border AdaptivePulseHalo { get; } = adaptivePulseHalo;
        public Border AdaptiveComposer { get; } = adaptiveComposer;
        public TextBox AdaptivePromptBox { get; } = adaptivePromptBox;
        public Button AdaptiveSendButton { get; } = adaptiveSendButton;
        public TextBlock AdaptiveRouteText { get; } = adaptiveRouteText;
        public TerminalView? TerminalView { get; set; }
        public Color MutedTextColor { get; set; } = Colors.Gray;
        public Border Inspector { get; } = inspector;
        public ScrollViewer InspectorBody { get; } = inspectorBody;
        public TextBlock InspectorHeading { get; } = inspectorHeading;
        public Button InspectorToggleButton { get; } = inspectorToggleButton;
        public Border InspectorSplitter { get; } = inspectorSplitter;
        public Border InspectorResizeTrack { get; } = inspectorResizeTrack;
        public Border InspectorResizeGrip { get; } = inspectorResizeGrip;
        public Border ReconnectBanner { get; } = reconnectBanner;
        public TextBlock ReconnectText { get; } = reconnectText;
        public Button ReconnectButton { get; } = reconnectButton;
        public Border RestoreOverlay { get; } = restoreOverlay;
        public TextBlock RestoreText { get; } = restoreText;
        public TextBlock TitleBlock { get; } = titleBlock;
        public TextBlock StatusGlyph { get; } = statusGlyph;
        public TextBlock ContextText { get; } = contextText;
        public ProgressBar ContextBar { get; } = contextBar;
        public ContextDonutControl ContextDonut { get; } = contextDonut;
        public IReadOnlyList<TextBlock> DetailHeadings { get; } = detailHeadings;
        public TextBlock ConfigText { get; } = configText;
        public TextBlock PromptText { get; } = promptText;
        public TextBox RenameBox { get; } = renameBox;
        public Button RenameButton { get; } = renameButton;
        public Button ArchiveButton { get; } = archiveButton;
        public Button SummaryButton { get; } = summaryButton;
        public Button StopButton { get; } = stopButton;
        public string WorkingDirectory { get; } = workingDirectory;
        public DashboardSession? Session { get; set; } = session;
        public TerminalSessionKind Kind { get; } = kind;
        public TerminalPaneState Pane { get; set; } = pane;
        public string ProviderId { get; } = providerId;
        public HashSet<string> KnownSessionIdsAtLaunch { get; set; } = [];
        public long LaunchedAt { get; set; }
        public bool IsAttached { get; set; }
        public bool IsLaunching { get; set; }
        public bool IsLaunched { get; set; }
        public bool IsRunning { get; set; }
        public bool SuppressReconnect { get; set; }
        public bool ReconnectLoopActive { get; set; }
        public bool AdaptiveSubmitting { get; set; }
        public int ReconnectAttempt { get; set; }
        public CancellationTokenSource? ReconnectCancellation { get; set; }
        public TaskCompletionSource<bool>? ReconnectNow { get; set; }
        public TerminalStartupGate? TerminalStartupGate { get; set; }
        public DispatcherTimer? TerminalStartupTimer { get; set; }
        public bool TerminalStartupAllowsQuietReveal { get; set; }
        public bool ArchiveConfirmationPending { get; set; }
    }
}
