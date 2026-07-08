using Avalonia;
using Avalonia.Automation;
using Avalonia.Collections;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Interactivity;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;
using CodexNative.Core;
using Iciclecreek.Terminal;

namespace CodexNative;

public sealed partial class MainWindow : Window
{
    private static readonly IBrush StartingBrush = Brush.Parse("#F59E0B");
    private static readonly IBrush RunningBrush = Brush.Parse("#22C55E");
    private static readonly IBrush ErrorBrush = Brush.Parse("#EF4444");

    private readonly NativeSettingsStore _settingsStore = new();
    private readonly DashboardApiClient _api = new();
    private readonly DashboardServiceManager _serviceManager = new();
    private readonly NativePlatformProfile _platform = NativePlatformProfile.Current;
    private readonly Dictionary<string, SessionTabState> _openTabs = [];
    private readonly Dictionary<string, TabItem> _previewTabs = [];
    private readonly DispatcherTimer _refreshTimer;
    private readonly DispatcherTimer _connectionPulseTimer;
    private readonly DispatcherTimer _sessionHoverAnimationTimer;
    private readonly TranslateTransform _sessionHoverTopTransform = new();
    private readonly TranslateTransform _sessionHoverBottomTransform = new();
    private Grid? _hoveredSessionRow;
    private DashboardStatusFeed? _statusFeed;
    private CancellationTokenSource? _searchCancellation;
    private Flyout? _newSessionFlyout;
    private NativeSettings _settings = NativeSettings.Default;
    private List<DashboardSession> _sessions = [];
    private List<DashboardSession> _archivedSessions = [];
    private List<DashboardRepo> _repos = [];
    private DashboardStats? _stats;
    private DashboardStatus? _dashboardStatus;
    private RateLimitInfo? _rateLimits;
    private DashboardTheme _currentTheme = DashboardTheme.All[0];
    private Color _sessionDividerAccent = Color.Parse(DashboardTheme.All[0].Accent);
    private Color _sessionDividerSecondary = Color.Parse(DashboardTheme.All[0].Secondary);
    private List<DashboardSession>? _searchResults;
    private readonly HashSet<string> _activeRepoPaths = new(StringComparer.Ordinal);
    private readonly HashSet<string> _hiddenTokenCategories = new(StringComparer.Ordinal);
    private bool _refreshing;
    private bool _initializingSelectors;
    private bool _initializingNavigation;
    private bool _initializingAnalytics;
    private bool _renderingRepoChips;
    private bool _shutdownConfirmed;
    private bool _closePromptOpen;
    private bool _uiReady;
    private bool _workspaceReady;
    private bool _isDashboardConnected;
    private int _refreshTick;
    private readonly DateTimeOffset _connectionPulseStartedAt = DateTimeOffset.UtcNow;
    private DateTimeOffset _sessionHoverAnimationStartedAt = DateTimeOffset.UtcNow;

    public MainWindow()
    {
        InitializeComponent();
        TerminalPathText.Text = _platform.UsesWsl
            ? "Terminal path: native view → persistent WSL2 PTY → Codex"
            : $"Terminal path: native view → persistent {_platform.DisplayName} PTY → Codex";
        ToolTip.SetTip(NewSessionButton, $"New Codex or {_platform.LocalShellLabel} session (Ctrl+Shift+N)");
        ToolTip.SetTip(CompactNewSessionButton, $"New Codex or {_platform.LocalShellLabel} session (Ctrl+Shift+N)");
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
            Dispatcher.UIThread.Post(ConstrainMainContentHeight, DispatcherPriority.Loaded);
        WorkspaceTabs.SizeChanged += (_, args) =>
        {
            var contentHeight = TerminalTabContentHeight(args.NewSize.Height);
            foreach (var state in _openTabs.Values)
            {
                state.TerminalViewport.Height = contentHeight;
            }
        };
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
        SetSessionFiltersExpanded(false);
        UpdateHeaderConnectionIndicator();
        _connectionPulseTimer.Start();
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
        var control = (e.KeyModifiers & KeyModifiers.Control) != 0;
        var shift = (e.KeyModifiers & KeyModifiers.Shift) != 0;
        if (control && e.Key == Key.K)
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
        if (control && shift && e.Key == Key.N)
        {
            ShowNewSessionChooser(SidebarBorder.IsVisible ? NewSessionButton : CompactNewSessionButton);
            e.Handled = true;
            return;
        }
        if (control && e.Key == Key.R)
        {
            await RefreshAllAsync();
            e.Handled = true;
            return;
        }
        if (control && e.Key == Key.W)
        {
            var state = _openTabs.Values.FirstOrDefault(candidate => ReferenceEquals(candidate.Tab, WorkspaceTabs.SelectedItem));
            if (state is not null)
            {
                await DetachTabAsync(state);
            }
            else if (WorkspaceTabs.SelectedItem is TabItem selected && !ReferenceEquals(selected, DashboardTab))
            {
                WorkspaceTabs.Items.Remove(selected);
                var preview = _previewTabs.FirstOrDefault(entry => ReferenceEquals(entry.Value, selected));
                if (!string.IsNullOrEmpty(preview.Key)) _previewTabs.Remove(preview.Key);
                WorkspaceTabs.SelectedItem = DashboardTab;
            }
            e.Handled = true;
            return;
        }
        if (e.Key == Key.Escape)
        {
            WorkspaceTabs.SelectedItem = DashboardTab;
            e.Handled = true;
        }
    }

    private async void OnWindowOpened(object? sender, EventArgs e)
    {
        _settings = await _settingsStore.LoadAsync();
        InitializeSelectors();
        InitializeNavigation();
        InitializeAnalytics();
        ApplyTheme(DashboardTheme.Find(_settings.StyleId));
        ApplyTextSize(DashboardTextSize.Find(_settings.TextSizeId));
        ApplySidebarState();
        await EnsureDashboardServiceAsync();
        await RefreshAllAsync();
        StartStatusFeed();
        await RestoreWorkspaceAsync();
        _workspaceReady = true;
        await SaveWorkspaceAsync();
        _refreshTimer.Start();
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

    private async Task EnsureDashboardServiceAsync()
    {
        SetStatus("Connecting to ui-my-cli data service…", StartingBrush);
        if (await _api.TryUseExistingServiceAsync())
        {
            SetStatus($"Dashboard connected on {_api.ConnectedPort} · persistent terminals enabled", RunningBrush);
            return;
        }

        try
        {
            var hostExecutable = Path.Combine(AppContext.BaseDirectory, _platform.TerminalHostFileName);
            _api.UsePrivateService();
            _serviceManager.EnsureStarted(
                _platform.Platform,
                hostExecutable,
                _settings.Distribution,
                _settings.DashboardWorkingDirectory,
                Environment.GetEnvironmentVariable("NODE_BIN"));
            for (var attempt = 0; attempt < 20; attempt++)
            {
                await Task.Delay(500);
                if (await _api.IsAvailableAsync())
                {
                    SetStatus("Started ui-my-cli data service · persistent terminals enabled", RunningBrush);
                    return;
                }
            }
            throw new TimeoutException("The native dashboard data service did not answer on port 7577.");
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Dashboard service startup failed: {ex}");
            SetStatus($"Dashboard data unavailable: {ex.Message}", ErrorBrush);
        }
    }

    private void StartStatusFeed()
    {
        if (_statusFeed is not null) return;
        _statusFeed = new DashboardStatusFeed(_api.StatusWebSocketUri);
        _statusFeed.SessionsReceived += sessions => Dispatcher.UIThread.Post(() => ApplyPushedSessions(sessions));
        _statusFeed.SessionRekeyed += (temporaryKey, realId) =>
            Dispatcher.UIThread.Post(() => ApplySessionRekey(temporaryKey, realId));
        _statusFeed.PendingSessionExpired += temporaryKey =>
            Dispatcher.UIThread.Post(() => RemoveExpiredPendingSession(temporaryKey));
        _statusFeed.ConnectionChanged += connected => Dispatcher.UIThread.Post(() =>
        {
            SetDashboardConnectionState(connected);
            if (connected) SetStatus($"Live push connected · {_sessions.Count:N0} sessions", RunningBrush);
        });
        _statusFeed.Start();
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
            || !_openTabs.TryGetValue(temporaryKey, out var state)
            || state.Kind != TerminalSessionKind.Codex) return;
        var session = _sessions.FirstOrDefault(candidate => candidate.Id == realId);
        _openTabs.Remove(temporaryKey);
        state.Key = realId;
        state.Session = session;
        state.TitleBlock.Text = session?.DisplayTitle ?? state.TitleBlock.Text;
        AutomationProperties.SetName(state.Tab, state.TitleBlock.Text ?? "Codex session");
        state.RenameBox.Text = session?.DisplayTitle ?? state.RenameBox.Text;
        state.ArchiveButton.IsVisible = session is not null;
        state.SummaryButton.IsVisible = session is not null;
        _openTabs[realId] = state;
        if (session is not null) _ = LoadSessionDetailsAsync(state, session);
        SetStatus($"Session registered · {realId[..Math.Min(8, realId.Length)]}", RunningBrush);
        _ = SaveWorkspaceAsync();
    }

    private void RemoveExpiredPendingSession(string temporaryKey)
    {
        if (!_openTabs.TryGetValue(temporaryKey, out var state)
            || state.Kind != TerminalSessionKind.Codex) return;
        CancelTerminalReconnect(state, suppress: true);
        state.Terminal.Kill();
        WorkspaceTabs.Items.Remove(state.Tab);
        _openTabs.Remove(temporaryKey);
        WorkspaceTabs.SelectedItem = DashboardTab;
        SetStatus("The new Codex session did not register and was stopped.", ErrorBrush);
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
            SetStatus($"Live · {_sessions.Count} sessions · persistent {_platform.DisplayName} terminals", RunningBrush);
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
        var selectedPath = (RepoComboBox.SelectedItem as RepoFilter)?.WorkingDir ?? _settings.SelectedRepo;
        var filters = new List<RepoFilter> { new("All projects", null) };
        filters.AddRange(_repos.Select(repo => new RepoFilter(repo.Project, repo.WorkingDir)));
        RepoComboBox.ItemsSource = filters;
        RepoComboBox.SelectedItem = filters.FirstOrDefault(filter => filter.WorkingDir == selectedPath) ?? filters[0];
        if (_activeRepoPaths.Count == 0 && _settings.SavedRepoPaths.Count > 0)
        {
            foreach (var path in _settings.SavedRepoPaths.Where(path => _repos.Any(repo => repo.WorkingDir == path)))
                _activeRepoPaths.Add(path);
        }
        RenderRepoChips();
    }

    private void RenderRepoChips()
    {
        _renderingRepoChips = true;
        RepoChipsPanel.Children.Clear();
        if (_repos.Count > 1)
        {
            var all = new ToggleButton
            {
                Content = "All",
                IsChecked = _activeRepoPaths.Count == 0,
                Padding = new Thickness(8, 3),
                Margin = new Thickness(0, 0, 5, 5),
            };
            all.Click += async (_, _) =>
            {
                if (_renderingRepoChips) return;
                _activeRepoPaths.Clear();
                RenderRepoChips();
                ApplySessionFilter();
                await SaveWorkspaceAsync();
            };
            RepoChipsPanel.Children.Add(all);
        }
        foreach (var repo in _repos)
        {
            var count = _sessions.Count(session => session.WorkingDir == repo.WorkingDir);
            var chip = new ToggleButton
            {
                Content = $"{repo.Project} ({count})",
                IsChecked = _activeRepoPaths.Contains(repo.WorkingDir),
                Tag = repo.WorkingDir,
                Padding = new Thickness(8, 3),
                Margin = new Thickness(0, 0, 5, 5),
                MaxWidth = 190,
            };
            chip.Click += async (_, _) =>
            {
                if (_renderingRepoChips || chip.Tag is not string path) return;
                if (chip.IsChecked == true) _activeRepoPaths.Add(path);
                else _activeRepoPaths.Remove(path);
                RenderRepoChips();
                ApplySessionFilter();
                await SaveWorkspaceAsync();
            };
            RepoChipsPanel.Children.Add(chip);
        }
        _renderingRepoChips = false;
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
        if (_activeRepoPaths.Count > 0 && _searchResults is null)
        {
            filtered = filtered.Where(session => _activeRepoPaths.Contains(session.WorkingDir));
        }
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
    }

    private static bool Contains(string? value, string query) =>
        value?.Contains(query, StringComparison.OrdinalIgnoreCase) == true;

    private void ReconcilePendingSessions()
    {
        var changed = false;
        foreach (var state in _openTabs.Values
                     .Where(state => state.Kind == TerminalSessionKind.Codex && state.Session is null && state.IsLaunched)
                     .ToList())
        {
            var candidate = _sessions
                .Where(session => session.WorkingDir == state.WorkingDirectory)
                .Where(session => !state.KnownSessionIdsAtLaunch.Contains(session.Id))
                .Where(session => session.CreatedAt >= state.LaunchedAt - 5)
                .Where(session => !_openTabs.Values.Any(other => other != state && other.Session?.Id == session.Id))
                .OrderBy(session => Math.Abs(session.CreatedAt - state.LaunchedAt))
                .FirstOrDefault();
            if (candidate is null) continue;

            _openTabs.Remove(state.Key);
            state.Key = candidate.Id;
            state.Session = candidate;
            state.TitleBlock.Text = candidate.DisplayTitle;
            AutomationProperties.SetName(state.Tab, candidate.DisplayTitle);
            state.RenameBox.Text = candidate.DisplayTitle;
            state.ArchiveButton.IsVisible = true;
            state.SummaryButton.IsVisible = true;
            _openTabs[candidate.Id] = state;
            changed = true;
            _ = LoadSessionDetailsAsync(state, candidate);
            SetStatus($"New session registered · {candidate.Id[..8]}", RunningBrush);
        }
        if (changed) _ = SaveWorkspaceAsync();
    }

    private async Task RestoreWorkspaceAsync()
    {
        foreach (var id in _settings.SavedSessionIds.Distinct(StringComparer.Ordinal))
        {
            var session = _sessions.FirstOrDefault(candidate => candidate.Id == id && !candidate.IsHeadless);
            if (session is not null) await OpenSessionAsync(session, activate: false, launch: false);
        }
        if (!string.IsNullOrWhiteSpace(_settings.ActiveSessionId)
            && _openTabs.TryGetValue(_settings.ActiveSessionId, out var active))
        {
            AttachTab(active);
            await EnsureTerminalLaunchedAsync(active);
        }
        else
        {
            WorkspaceTabs.SelectedItem = DashboardTab;
        }
    }

    private async Task SaveWorkspaceAsync()
    {
        if (!_workspaceReady) return;
        var active = _openTabs.Values.FirstOrDefault(state => ReferenceEquals(WorkspaceTabs.SelectedItem, state.Tab));
        _settings = _settings with
        {
            OpenSessionIds = _openTabs.Values
                .Where(state => state.IsAttached && state.Session is not null)
                .Select(state => state.Session!.Id)
                .Distinct(StringComparer.Ordinal)
                .ToList(),
            ActiveSessionId = active?.Session?.Id,
            SidebarCollapsed = !SidebarBorder.IsVisible,
            SelectedRepo = (RepoComboBox.SelectedItem as RepoFilter)?.WorkingDir,
            SelectedRepos = _activeRepoPaths.Order(StringComparer.Ordinal).ToList(),
            ShowHeadless = ShowHeadlessCheckBox.IsChecked == true,
            IncludeArchived = ArchivedCheckBox.IsChecked == true,
            SearchQuery = SearchTextBox.Text ?? string.Empty,
            NeedsInputOnly = NeedsInputCheckBox.IsChecked == true,
            SidebarWidth = SidebarBorder.IsVisible ? MainContentGrid.ColumnDefinitions[0].ActualWidth : _settings.SidebarWidth,
        };
        await PersistSettingsAsync();
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
        var totalTokens = stats.Models.Sum(model => model.TotalTokens);
        var totalCalls = stats.Models.Sum(model => model.Calls);
        StatsSummaryText.Text =
            $"{stats.Activity.H24:N0} active in 24h   ·   {stats.Activity.Total:N0} sessions   ·   " +
            $"{FormatNumber(totalTokens)} tokens   ·   {FormatNumber(totalCalls)} model calls   ·   " +
            $"{stats.TotalSubagents:N0} subagents   ·   {CohortLabel(stats.StatsFilters.StatsMode)} cohort";
        StatsCohortPanel.IsVisible = stats.StatsFilters.TranscriptHeadlessCount > 0;

        PopulateMetricRows(
            ProjectsPanel,
            stats.Projects.OrderByDescending(project => project.Messages).Take(5)
                .Select(project => (project.Name, (long)project.Messages, $"{project.Sessions:N0} sessions · {FormatDuration(project.DurationSec)}")));
        ProjectComboGraph.MessagesBrush = Brush.Parse("#38BDF8");
        ProjectComboGraph.DurationBrush = StartingBrush;
        ProjectComboGraph.SessionsBrush = ResourceBrush("AccentBrush");
        ProjectComboGraph.GridBrush = ResourceBrush("BorderBrush");
        ProjectComboGraph.SetData(stats.Projects.OrderByDescending(project => project.Messages).Take(10).ToList());
        PopulateModelRows(stats.Models.OrderByDescending(model => model.TotalTokens).Take(10));
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

        var window = _settings.AnalyticsWindow;
        if (!stats.TokensByHour.TryGetValue(window, out var tokenWindow))
            stats.TokensByHour.TryGetValue("7d", out tokenWindow);
        TokenActivityGraph.InputBrush = Brush.Parse("#38BDF8");
        TokenActivityGraph.OutputBrush = ResourceBrush("AccentBrush");
        TokenActivityGraph.GridBrush = ResourceBrush("BorderBrush");
        TokenActivityGraph.SetData(tokenWindow?.Input, tokenWindow?.Output);
        if (ResourceBrush("AccentBrush") is SolidColorBrush accent) TokenHeatmapGraph.AccentColor = accent.Color;
        TokenHeatmapGraph.EmptyBrush = ResourceBrush("ElevatedBrush");
        TokenHeatmapGraph.SetData(stats.TokenHeatmap
            .Select(row => (IReadOnlyList<long>)row.Select(cell =>
                cell.Windows.TryGetValue(window == "all" ? "30d" : window, out var value) ? value : 0).ToList())
            .ToList());

        PopulateLeaderboard(DurationLeadersPanel, stats.TopSessionsByDuration, entry => entry.DurationSec, entry => entry.DurationStr);
        PopulateLeaderboard(MessageLeadersPanel, stats.TopSessionsByUserMsgs, entry => entry.UserMsgCount, entry => $"{entry.UserMsgCount:N0} messages");
        PopulateTokenLeaderboard(stats.TopSessionsByTokens);
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

    private void PopulateMetricRows(Panel panel, IEnumerable<(string Label, long Value, string Detail)> rows)
    {
        panel.Children.Clear();
        var materialized = rows.ToList();
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

    private void PopulateModelRows(IEnumerable<ModelStats> models)
    {
        ModelsPanel.Children.Clear();
        foreach (var model in models)
        {
            var bar = new StackedTokenBar { Height = 7 };
            bar.SegmentBrushes = TokenCategoryBrushes();
            AutomationProperties.SetName(bar, $"Token composition for {model.Model}, reasoning {model.ReasoningEffort}");
            var values = TokenCategoryValues(
                model.VisibleOutputTokens,
                model.ReasoningOutputTokens,
                model.InputTokens,
                model.CachedInputTokens,
                model.CacheWriteTokens,
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
                        Text = $"{FormatNumber(visibleTotal)} visible · {FormatNumber(model.TotalTokens)} total · {model.Calls:N0} calls · {model.Sessions:N0} sessions",
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

    private void PopulateTokenLeaderboard(IEnumerable<SessionRanking> entries)
    {
        TokenLeadersPanel.Children.Clear();
        var rows = entries.Take(10).ToList();
        foreach (var entry in rows)
        {
            var values = TokenCategoryValues(
                entry.VisibleOutputTokens,
                entry.ReasoningOutputTokens,
                entry.InputTokens,
                entry.CachedInputTokens,
                entry.CacheWriteTokens,
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
                                LeaderValue($"{FormatNumber(visibleTotal)} tokens"),
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
        PopulateModelRows(_stats.Models.OrderByDescending(model => model.TotalTokens).Take(10));
        PopulateTokenLeaderboard(_stats.TopSessionsByTokens);
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
        var codex = status.Providers.FirstOrDefault(provider => provider.Id == "codex");
        ProviderHealthBar.Value = codex?.Available == true ? 100 : 0;
        ProviderStatusText.Text = codex is null
            ? $"Codex provider not reported · {status.ActivePtys:N0} persistent terminals"
            : $"{(codex.Available ? "Available" : "Unavailable")} · {codex.Version ?? "version unknown"} · " +
              $"{status.ActivePtys:N0} persistent terminal{(status.ActivePtys == 1 ? string.Empty : "s")} · " +
              $"service up {FormatDuration(status.Uptime)}";
    }

    private void RenderRateLimits(RateLimitInfo? rateLimits)
    {
        if (rateLimits is null)
        {
            RateLimitText.Text = "Codex has not emitted rate-limit telemetry for the latest session.";
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

    private async Task OpenSessionAsync(DashboardSession session, bool activate = true, bool launch = true)
    {
        if (session.IsHeadless || session.Archived)
        {
            await OpenPreviewAsync(session);
            return;
        }
        if (_openTabs.TryGetValue(session.Id, out var existing))
        {
            AttachTab(existing, activate);
            if (launch) await EnsureTerminalLaunchedAsync(existing);
            return;
        }

        var state = CreateTerminalTab(
            session.Id, session.DisplayTitle, session.WorkingDir, session, TerminalSessionKind.Codex);
        _openTabs.Add(session.Id, state);
        WorkspaceTabs.Items.Add(state.Tab);
        state.IsAttached = true;
        if (activate) WorkspaceTabs.SelectedItem = state.Tab;
        if (launch)
        {
            await EnsureTerminalLaunchedAsync(state);
        }
        _ = LoadSessionDetailsAsync(state, session);
        await SaveWorkspaceAsync();
    }

    private async Task OpenNewSessionAsync(string workingDirectory)
    {
        try
        {
            var key = await _api.CreateSessionAsync(workingDirectory);
            var project = workingDirectory.TrimEnd('/').Split('/').LastOrDefault() ?? workingDirectory;
            var state = CreateTerminalTab(
                key, $"New · {project}", workingDirectory, null, TerminalSessionKind.Codex);
            state.KnownSessionIdsAtLaunch = _sessions.Select(session => session.Id).ToHashSet(StringComparer.Ordinal);
            state.LaunchedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            _openTabs.Add(key, state);
            WorkspaceTabs.Items.Add(state.Tab);
            state.IsAttached = true;
            WorkspaceTabs.SelectedItem = state.Tab;
            await LaunchTerminalAsync(state);
            await SaveWorkspaceAsync();
        }
        catch (Exception ex)
        {
            SetStatus($"New session failed: {ex.Message}", ErrorBrush);
        }
    }

    private async Task OpenLocalShellSessionAsync(string workingDirectory)
    {
        try
        {
            var key = $"ubuntu:{Guid.NewGuid():N}";
            var project = workingDirectory.TrimEnd('/').Split('/').LastOrDefault() ?? workingDirectory;
            var title = $"{_platform.LocalShellLabel} · {project}";
            var state = CreateTerminalTab(
                key, title, workingDirectory, null, TerminalSessionKind.LocalShell);
            _openTabs.Add(key, state);
            WorkspaceTabs.Items.Add(state.Tab);
            state.IsAttached = true;
            WorkspaceTabs.SelectedItem = state.Tab;
            await EnsureTerminalLaunchedAsync(state);
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
        TerminalSessionKind kind)
    {
        var isLocalShell = kind == TerminalSessionKind.LocalShell;
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
        AutomationProperties.SetName(restoreOverlay, "Restoring Codex conversation");
        AutomationProperties.SetLiveSetting(restoreOverlay, AutomationLiveSetting.Polite);

        var contextText = MakeDetailText(isLocalShell
            ? $"Interactive login shell on {_platform.DisplayName}."
            : "Context data will load after the terminal opens.");
        var contextBar = new ProgressBar { Minimum = 0, Maximum = 100, Height = 7, Margin = new Thickness(0, 5, 0, 7) };
        var contextDonut = new ContextDonutControl
        {
            Width = 82,
            Height = 82,
            Margin = new Thickness(0, 3, 8, 0),
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
            : session is null ? "New session configuration is managed by Codex." : "Loading model, permissions, rules, and skills…");
        var promptText = MakeDetailText(isLocalShell
            ? "Run Linux commands directly. Type exit or close the tab to end this shell."
            : session?.LastUserPrompt ?? "The terminal is ready for a new prompt.");

        var detailsGrid = new Grid { ColumnDefinitions = new ColumnDefinitions("1.1*,1*,1.4*"), ColumnSpacing = 16 };
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

        var renameBox = new TextBox { Text = title, MinWidth = 180, Width = 260, PlaceholderText = "Session title" };
        var renameButton = new Button { Content = "Rename", Padding = new Thickness(10, 4) };
        var archiveButton = new Button { Content = "Archive", Padding = new Thickness(10, 4), IsVisible = session is not null };
        var summaryButton = new Button { Content = "Summary", Padding = new Thickness(10, 4), IsVisible = session is not null };
        var stopButton = new Button { Content = "Stop", Padding = new Thickness(10, 4) };
        ToolTip.SetTip(stopButton, isLocalShell
            ? $"Stop the {_platform.LocalShellLabel} and remove this tab"
            : "Stop the Codex process and remove this tab");
        var actions = new WrapPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        foreach (var action in new Control[] { renameBox, summaryButton, renameButton, archiveButton, stopButton })
        {
            action.Margin = new Thickness(0, 0, 7, 7);
            actions.Children.Add(action);
        }
        detailsGrid.SizeChanged += (_, args) => ReflowGrid(detailsGrid, args.NewSize.Width >= 720 ? 3 : 1);

        var inspector = new Border
        {
            MinHeight = 120,
            MaxHeight = 480,
            Background = ResourceBrush("SurfaceBrush"),
            BorderBrush = ResourceBrush("BorderBrush"),
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(14, 10),
            Child = new Grid
            {
                RowDefinitions = new RowDefinitions("Auto,Auto"),
                RowSpacing = 9,
                Children = { detailsGrid, actions },
            },
        };
        Grid.SetRow(actions, 1);

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
            IsHitTestVisible = false,
        };
        var inspectorSplitter = new GridSplitter
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Background = Brushes.Transparent,
            ResizeDirection = GridResizeDirection.Rows,
            ResizeBehavior = GridResizeBehavior.PreviousAndNext,
            ShowsPreview = true,
            Cursor = new Cursor(StandardCursorType.SizeNorthSouth),
        };
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
            RowDefinitions = new RowDefinitions("*,12,160"),
            Background = ResourceBrush("TerminalBrush"),
            MinHeight = 0,
            ClipToBounds = true,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        content.Loaded += (_, _) =>
            content.Height = TerminalTabContentHeight(WorkspaceTabs.Bounds.Height);
        var terminalClip = new Border
        {
            ClipToBounds = true,
            Background = Brushes.Transparent,
            Child = terminal,
        };
        content.Children.Add(terminalClip);
        content.Children.Add(reconnectBanner);
        content.Children.Add(restoreOverlay);
        content.Children.Add(inspectorResizeTrack);
        content.Children.Add(inspectorSplitter);
        content.Children.Add(inspector);
        Grid.SetRow(inspectorResizeTrack, 1);
        Grid.SetRow(inspectorSplitter, 1);
        Grid.SetRow(inspector, 2);
        terminalClip.ZIndex = 0;
        inspectorResizeTrack.ZIndex = 2;
        inspectorSplitter.ZIndex = 3;
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
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 7,
            Children =
            {
                new TextBlock { Text = "●", FontSize = TabIconFontSize(textSize), Foreground = StartingBrush, VerticalAlignment = VerticalAlignment.Center },
                new TextBlock { Text = title, FontSize = tabFontSize, MaxWidth = 220, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center },
                closeButton,
            },
        };
        var statusGlyph = (TextBlock)header.Children[0];
        var titleBlock = (TextBlock)header.Children[1];
        var tab = new TabItem
        {
            Header = header,
            Content = content,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
        };
        AutomationProperties.SetName(tab, title);
        var state = new SessionTabState(
            key, tab, terminal, content, inspector, inspectorSplitter,
            inspectorResizeTrack, inspectorResizeGrip,
            reconnectBanner, reconnectText, reconnectButton,
            restoreOverlay, restoreText,
            titleBlock, statusGlyph, contextText, contextBar, contextDonut,
            detailHeadings, configText,
            promptText, renameBox, renameButton, archiveButton, summaryButton, stopButton,
            workingDirectory, session, kind);

        ApplyThemeToSessionState(state, DashboardTheme.Find(_settings.StyleId));
        inspectorSplitter.AddHandler(
            InputElement.PointerPressedEvent,
            (_, _) => BeginTerminalResizeMask(state),
            RoutingStrategies.Tunnel,
            handledEventsToo: true);
        inspectorSplitter.AddHandler(
            InputElement.PointerMovedEvent,
            (_, args) =>
            {
                if (args.GetCurrentPoint(inspectorSplitter).Properties.IsLeftButtonPressed)
                    BeginTerminalResizeMask(state);
            },
            RoutingStrategies.Tunnel | RoutingStrategies.Bubble,
            handledEventsToo: true);
        inspectorSplitter.DragCompleted += (_, _) => CompleteTerminalResizeReveal(state);
        terminal.Loaded += (_, _) => AttachTerminalVisualStyling(state);

        closeButton.Click += async (_, _) => await DetachTabAsync(state);
        stopButton.Click += async (_, _) => await StopAndRemoveTabAsync(state);
        summaryButton.Click += async (_, _) =>
        {
            if (state.Session is not null) await OpenPreviewAsync(state.Session);
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

    private static double TerminalTabContentHeight(double workspaceHeight) =>
        Math.Max(240, workspaceHeight - 46);

    private async void OnTerminalPasteKeyDown(object? sender, KeyEventArgs args)
    {
        var control = (args.KeyModifiers & KeyModifiers.Control) != 0;
        var shift = (args.KeyModifiers & KeyModifiers.Shift) != 0;
        var alt = (args.KeyModifiers & KeyModifiers.Alt) != 0;
        var standardPaste = args.Key == Key.V && control && !alt;
        var terminalPaste = args.Key == Key.Insert && shift && !control && !alt;
        if (!standardPaste && !terminalPaste) return;

        args.Handled = true;
        if (sender is not TerminalControl terminal) return;
        var terminalView = args.Source as TerminalView
            ?? terminal.GetVisualDescendants().OfType<TerminalView>().FirstOrDefault();
        if (terminalView is null) return;

        try
        {
            terminalView.Focus();
            await terminalView.PasteAsync();
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Terminal paste failed: {ex}");
            SetStatus($"Paste failed: {ex.Message}", ErrorBrush);
        }
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
        var panel = new StackPanel { Spacing = 2 };
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
        var details = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        details.Children.Add(progress);
        details.Children.Add(body);
        var composition = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
        composition.Children.Add(donut);
        composition.Children.Add(details);
        Grid.SetColumn(details, 1);
        var panel = new StackPanel { Spacing = 2 };
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
        if (state.Kind == TerminalSessionKind.Codex && state.Session is not null)
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
                    _api.TerminalWebSocketUri(state.Key).AbsoluteUri),
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

    private void AttachTab(SessionTabState state, bool activate = true)
    {
        state.SuppressReconnect = false;
        if (!state.IsAttached)
        {
            WorkspaceTabs.Items.Add(state.Tab);
            state.IsAttached = true;
        }
        if (activate) WorkspaceTabs.SelectedItem = state.Tab;
    }

    private async Task DetachTabAsync(SessionTabState state)
    {
        if (state.Kind == TerminalSessionKind.LocalShell)
        {
            await StopAndRemoveTabAsync(state);
            return;
        }
        CancelTerminalReconnect(state, suppress: true);
        EndTerminalStartupReveal(state);
        WorkspaceTabs.Items.Remove(state.Tab);
        state.IsAttached = false;
        WorkspaceTabs.SelectedItem = DashboardTab;
        SetStatus($"Detached {state.TitleBlock.Text} · persistent {_platform.DisplayName} process continues", RunningBrush);
        await SaveWorkspaceAsync();
    }

    private async Task StopAndRemoveTabAsync(SessionTabState state)
    {
        CancelTerminalReconnect(state, suppress: true);
        EndTerminalStartupReveal(state);
        if (state.Kind == TerminalSessionKind.Codex)
        {
            try { await _api.KillTerminalAsync(state.Key); }
            catch (Exception ex) { NativeLog.Write($"Server PTY stop failed for {state.Key}: {ex.Message}"); }
        }
        state.Terminal.Kill();
        state.IsRunning = false;
        state.IsLaunched = false;
        WorkspaceTabs.Items.Remove(state.Tab);
        state.IsAttached = false;
        _openTabs.Remove(state.Key);
        WorkspaceTabs.SelectedItem = DashboardTab;
        SetStatus($"Stopped {state.TitleBlock.Text}", StartingBrush);
        await SaveWorkspaceAsync();
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

    private void BeginTerminalResizeMask(SessionTabState state)
    {
        if (state.TerminalStartupGate is not null) return;
        if (state.TerminalResizeMaskActive) return;
        state.TerminalResizeMaskActive = true;
        AutomationProperties.SetHelpText(state.InspectorSplitter, "Terminal redraw hidden while resizing");
        state.Terminal.Opacity = 0;
        state.Terminal.IsHitTestVisible = false;
        state.RestoreText.Text = "Resizing terminal view…";
        state.RestoreOverlay.IsVisible = true;
    }

    private void CompleteTerminalResizeReveal(SessionTabState state)
    {
        if (!state.TerminalResizeMaskActive || state.TerminalStartupGate is not null) return;
        state.TerminalStartupGate = new TerminalStartupGate(
            DateTimeOffset.UtcNow,
            minimumWait: TimeSpan.FromMilliseconds(120),
            quietPeriod: TimeSpan.FromMilliseconds(240),
            noOutputMaximumWait: TimeSpan.FromMilliseconds(500),
            maximumWait: TimeSpan.FromMilliseconds(1800));
        state.TerminalStartupAllowsQuietReveal = true;
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
        state.TerminalResizeMaskActive = false;
        AutomationProperties.SetHelpText(state.InspectorSplitter, "Drag to resize session details");
        state.RestoreOverlay.IsVisible = false;
        state.Terminal.Opacity = 1;
        state.Terminal.IsHitTestVisible = true;
        RestyleTerminalText(state);
        state.TerminalView?.InvalidateVisual();
        state.Terminal.InvalidateVisual();
        if (state.IsAttached && ReferenceEquals(WorkspaceTabs.SelectedItem, state.Tab))
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
            var contextTask = _api.GetContextAsync(session.Id);
            var configTask = _api.GetConfigAsync(session.Id);
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
                state.TitleBlock.Text ?? (state.Kind == TerminalSessionKind.LocalShell ? _platform.LocalShellLabel : "New Codex session"));
            return;
        }
        var title = state.RenameBox.Text?.Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            return;
        }
        try
        {
            await _api.RenameAsync(state.Session.Id, title);
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
            await _api.ArchiveAsync(state.Session.Id);
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
            var current = _sessions.FirstOrDefault(session => session.Id == state.Session.Id);
            if (current is not null)
            {
                state.Session.Status = current.Status;
                state.PromptText.Text = current.LastUserPrompt;
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
            await OpenSelectedSessionAsync(session);
        }
    }

    private async void OnCompactSessionSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (CompactSessionsList.SelectedItem is not DashboardSession session) return;
        CompactSessionsList.SelectedItem = null;
        await OpenSelectedSessionAsync(session);
    }

    private Task OpenSelectedSessionAsync(DashboardSession session) =>
        session.IsHeadless || session.Archived
            ? OpenPreviewAsync(session)
            : OpenSessionAsync(session);

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
            await _api.RestoreAsync(session.Id);
            await RefreshAllAsync();
            ArchivedCheckBox.IsChecked = false;
            SetStatus($"Restored {session.DisplayTitle}", RunningBrush);
        }
        catch (Exception ex)
        {
            SetStatus($"Restore failed: {ex.Message}", ErrorBrush);
        }
    }

    private async Task OpenPreviewAsync(DashboardSession session)
    {
        var key = $"preview:{session.Id}";
        if (_previewTabs.TryGetValue(key, out var existing))
        {
            WorkspaceTabs.SelectedItem = existing;
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
            WorkspaceTabs.Items.Remove(tab);
            _previewTabs.Remove(key);
            if (selectDashboard) WorkspaceTabs.SelectedItem = DashboardTab;
        }
        async Task RenamePreviewAsync(string title)
        {
            await _api.RenameAsync(session.Id, title);
            session.Title = title;
            if (header.Children.ElementAtOrDefault(1) is TextBlock titleBlock) titleBlock.Text = title;
            if (tab is not null) AutomationProperties.SetName(tab, $"Session summary: {title}");
            await RefreshSessionsAsync();
            SetStatus($"Renamed {title}", RunningBrush);
        }
        async Task ArchivePreviewAsync()
        {
            await _api.ArchiveAsync(session.Id);
            if (_openTabs.TryGetValue(session.Id, out var openState)) await StopAndRemoveTabAsync(openState);
            session.Archived = true;
            ClosePreview();
            await RefreshAllAsync();
            SetStatus($"Archived {session.DisplayTitle}", StartingBrush);
        }
        async Task RestorePreviewAsync()
        {
            await _api.RestoreAsync(session.Id);
            session.Archived = false;
            ArchivedCheckBox.IsChecked = false;
            await RefreshAllAsync();
            if (preview is not null) await preview.ReloadAsync();
            SetStatus($"Restored {session.DisplayTitle}", RunningBrush);
        }
        async Task ResumePreviewAsync()
        {
            if (session.IsHeadless || session.Archived) return;
            ClosePreview(selectDashboard: false);
            var current = _sessions.FirstOrDefault(candidate => candidate.Id == session.Id) ?? session;
            await OpenSessionAsync(current);
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
        WorkspaceTabs.Items.Add(tab);
        WorkspaceTabs.SelectedItem = tab;
        await Task.CompletedTask;
    }

    private void OnNewSessionClicked(object? sender, RoutedEventArgs e)
    {
        if (sender is Control anchor) ShowNewSessionChooser(anchor);
    }

    private void ShowNewSessionChooser(Control anchor)
    {
        _newSessionFlyout?.Hide();
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
                        : $"Start new Codex session in {label}");
                button.Click += async (_, _) =>
                {
                    _newSessionFlyout?.Hide();
                    if (selectedKind == TerminalSessionKind.LocalShell)
                        await OpenLocalShellSessionAsync(repo.WorkingDir);
                    else
                        await OpenNewSessionAsync(repo.WorkingDir);
                };
                options.Children.Add(button);
            }
            if (visible.Count == 0)
                options.Children.Add(new TextBlock { Text = "No matching projects", Foreground = ResourceBrush("MutedBrush"), Margin = new Thickness(8) });
        }

        var codexChoice = new Button
        {
            Content = "Codex session",
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
        AutomationProperties.SetName(codexChoice, "Choose Codex session");
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
                ? "Start or register a persistent Codex CLI session in the selected project."
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
        var state = _openTabs.Values.FirstOrDefault(candidate => ReferenceEquals(candidate.Tab, WorkspaceTabs.SelectedItem));
        if (state is not null) await EnsureTerminalLaunchedAsync(state);
        await SaveWorkspaceAsync();
    }

    private async void OnRefreshClicked(object? sender, RoutedEventArgs e)
    {
        if (!await _api.IsAvailableAsync())
        {
            await EnsureDashboardServiceAsync();
        }
        await RefreshAllAsync();
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
        foreach (var state in _openTabs.Values)
        {
            ApplyThemeToSessionState(state, theme);
        }
        foreach (var tab in _previewTabs.Values)
        {
            if (tab.Header is StackPanel header)
            {
                if (header.Children.ElementAtOrDefault(0) is TextBlock icon) icon.Foreground = Brush.Parse(theme.Accent);
                if (header.Children.ElementAtOrDefault(1) is TextBlock title) title.Foreground = Brush.Parse(theme.Primary);
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
        state.InspectorSplitter.Background = Brushes.Transparent;
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
        state.ContextText.Foreground = secondary;
        state.ConfigText.Foreground = secondary;
        state.PromptText.Foreground = secondary;
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

    private void ApplyTextSize(DashboardTextSize size)
    {
        FontSize = 13 * size.Scale;
        foreach (var state in _openTabs.Values)
        {
            state.Terminal.FontSize = size.TerminalFontSize;
        }
        foreach (var tab in WorkspaceTabs.Items.OfType<TabItem>()) ApplyTabHeaderTextSize(tab, size);
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

    private static void AttachTerminalVisualStyling(SessionTabState state)
    {
        if (state.TerminalView is not null) return;
        var terminalView = state.Terminal
            .GetVisualDescendants()
            .OfType<TerminalView>()
            .FirstOrDefault();
        if (terminalView is null) return;

        state.TerminalView = terminalView;
        terminalView.Terminal.BufferChanged += (_, _) =>
            Dispatcher.UIThread.Post(() =>
            {
                state.TerminalStartupGate?.ObserveOutput(DateTimeOffset.UtcNow);
                if (state.TerminalStartupGate is null) RestyleTerminalText(state);
            });
        RestyleTerminalText(state);
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
            var changed = false;
            for (var cellIndex = 0; cellIndex < line.Length; cellIndex++)
            {
                var cell = line[cellIndex];
                if (!cell.Attributes.IsDim()) continue;
                var attributes = cell.Attributes;
                if (attributes.GetFgColorMode() == (int)XTerm.Common.ColorMode.RGB
                    && attributes.GetFgColor() == packedRgb
                    && !attributes.IsBold()) continue;
                attributes.SetFgColor(packedRgb, (int)XTerm.Common.ColorMode.RGB);
                attributes.SetBold(false);
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
        if (!await _api.IsAvailableAsync())
        {
            await EnsureDashboardServiceAsync();
        }
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

    private void ShutdownNativeResources()
    {
        _refreshTimer.Stop();
        _connectionPulseTimer.Stop();
        _sessionHoverAnimationTimer.Stop();
        if (_statusFeed is not null) _ = _statusFeed.DisposeAsync();
        _searchCancellation?.Cancel();
        foreach (var state in _openTabs.Values.ToList())
        {
            CancelTerminalReconnect(state, suppress: true);
            EndTerminalStartupReveal(state);
            state.Terminal.Kill();
        }
        _serviceManager.Dispose();
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
        AutomationProperties.SetName(HomeButton, "CODEX NATIVE DASHBOARD");
        AutomationProperties.SetHelpText(HomeButton, $"{label}. Go to dashboard.");
    }

    private void OnConnectionPulseTick(object? sender, EventArgs e)
    {
        var elapsedSeconds = (DateTimeOffset.UtcNow - _connectionPulseStartedAt).TotalSeconds;
        var intensity = (Math.Cos(elapsedSeconds / 2.4 * Math.PI * 2) + 1) / 2;
        HeaderStatusDot.Opacity = 0.42 + intensity * 0.58;
        HeaderStatusHalo.Opacity = 0.08 + intensity * 0.2;
    }

    private void ApplyWindowsTitleBarTheme(DashboardTheme theme)
    {
        var handle = TryGetPlatformHandle();
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

    private enum TerminalSessionKind
    {
        Codex,
        LocalShell,
    }

    private sealed class SessionTabState(
        string key,
        TabItem tab,
        TerminalControl terminal,
        Grid terminalViewport,
        Border inspector,
        GridSplitter inspectorSplitter,
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
        TerminalSessionKind kind)
    {
        public string Key { get; set; } = key;
        public TabItem Tab { get; } = tab;
        public TerminalControl Terminal { get; } = terminal;
        public Grid TerminalViewport { get; } = terminalViewport;
        public TerminalView? TerminalView { get; set; }
        public Color MutedTextColor { get; set; } = Colors.Gray;
        public Border Inspector { get; } = inspector;
        public GridSplitter InspectorSplitter { get; } = inspectorSplitter;
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
        public HashSet<string> KnownSessionIdsAtLaunch { get; set; } = [];
        public long LaunchedAt { get; set; }
        public bool IsAttached { get; set; }
        public bool IsLaunching { get; set; }
        public bool IsLaunched { get; set; }
        public bool IsRunning { get; set; }
        public bool SuppressReconnect { get; set; }
        public bool ReconnectLoopActive { get; set; }
        public int ReconnectAttempt { get; set; }
        public CancellationTokenSource? ReconnectCancellation { get; set; }
        public TaskCompletionSource<bool>? ReconnectNow { get; set; }
        public TerminalStartupGate? TerminalStartupGate { get; set; }
        public DispatcherTimer? TerminalStartupTimer { get; set; }
        public bool TerminalStartupAllowsQuietReveal { get; set; }
        public bool TerminalResizeMaskActive { get; set; }
        public bool ArchiveConfirmationPending { get; set; }
    }
}
