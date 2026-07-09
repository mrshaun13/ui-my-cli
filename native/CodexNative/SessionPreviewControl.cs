using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using CodexNative.Core;

namespace CodexNative;

public sealed class SessionPreviewControl : UserControl
{
    private readonly DashboardApiClient _api;
    private readonly DashboardSession _session;
    private readonly Func<string, IBrush> _brush;
    private readonly Func<string, Task> _rename;
    private readonly Func<Task> _archive;
    private readonly Func<Task> _restore;
    private readonly Func<Task> _resume;
    private readonly StackPanel _root = new() { Spacing = 12, Margin = new Thickness(18) };
    private readonly TextBlock _status = new() { Text = "Loading session summary…" };
    private readonly StackPanel _conversation = new() { Spacing = 10 };
    private readonly TextBlock _conversationCount = new();
    private readonly TextBox _conversationSearch = new()
    {
        Width = 230,
        MaxLength = ConversationSearch.MaximumQueryLength,
        PlaceholderText = "Find in loaded conversation…",
    };
    private readonly Button _loadMoreButton = new() { Content = "Load more", Padding = new Thickness(12, 6), IsVisible = false };
    private readonly Button _loadAllButton = new() { Content = "Load all", Padding = new Thickness(12, 6), IsVisible = false };
    private readonly WrapPanel _conversationToolbar = new() { Orientation = Orientation.Horizontal };
    private readonly List<ConversationTurn> _conversationTurns = [];
    private readonly ScrollViewer _scroll = new()
    {
        HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
        VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
    };
    private CancellationTokenSource? _reloadCancellation;
    private CancellationTokenSource? _conversationSearchCancellation;
    private int _conversationTotal;
    private int _nextConversationBatch = 50;
    private string ProviderId =>
        string.IsNullOrWhiteSpace(_session.Provider) ? _api.ProviderId : _session.Provider;
    private string ProviderLabel =>
        string.IsNullOrWhiteSpace(ProviderId) ? "CODEX" : ProviderId.ToUpperInvariant();

    public SessionPreviewControl(
        DashboardApiClient api,
        DashboardSession session,
        Func<string, IBrush> brush,
        Func<string, Task> rename,
        Func<Task> archive,
        Func<Task> restore,
        Func<Task> resume)
    {
        _api = api;
        _session = session;
        _brush = brush;
        _rename = rename;
        _archive = archive;
        _restore = restore;
        _resume = resume;
        Background = _brush("BaseBrush");
        _status.Foreground = _brush("SecondaryBrush");
        _loadMoreButton.Click += async (_, _) =>
            await LoadConversationAsync(ConversationLoad.More, _reloadCancellation?.Token ?? CancellationToken.None);
        _loadAllButton.Click += async (_, _) =>
            await LoadConversationAsync(ConversationLoad.All, _reloadCancellation?.Token ?? CancellationToken.None);
        _conversationSearch.TextChanged += OnConversationSearchChanged;
        AutomationProperties.SetName(_conversationSearch, "Find in loaded conversation");
        _conversationCount.VerticalAlignment = VerticalAlignment.Center;
        _conversationCount.Margin = new Thickness(0, 0, 10, 7);
        _conversationSearch.Margin = new Thickness(0, 0, 7, 7);
        _loadMoreButton.Margin = new Thickness(0, 0, 7, 7);
        _loadAllButton.Margin = new Thickness(0, 0, 0, 7);
        _conversationToolbar.Children.Add(_conversationCount);
        _conversationToolbar.Children.Add(_conversationSearch);
        _conversationToolbar.Children.Add(_loadMoreButton);
        _conversationToolbar.Children.Add(_loadAllButton);
        SizeChanged += (_, args) => _root.Width = Math.Max(0, args.NewSize.Width - 36);
        _scroll.Content = _root;
        Content = _scroll;
        DetachedFromVisualTree += OnDetachedFromVisualTree;
        _ = ReloadAsync();
    }

    private void OnConversationSearchChanged(object? sender, TextChangedEventArgs e)
    {
        var previous = _conversationSearchCancellation;
        var current = new CancellationTokenSource();
        _conversationSearchCancellation = current;
        previous?.Cancel();
        previous?.Dispose();
        _ = RenderConversationAfterDelayAsync(current);
    }

    private async Task RenderConversationAfterDelayAsync(CancellationTokenSource owner)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(120), owner.Token);
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                if (!owner.IsCancellationRequested && ReferenceEquals(owner, _conversationSearchCancellation))
                    RenderConversation();
            }, DispatcherPriority.Background);
        }
        catch (OperationCanceledException) when (owner.IsCancellationRequested)
        {
            // A newer keystroke owns the next render.
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Conversation search render failed for {_session.Id}: {ex}");
        }
    }

    private void OnDetachedFromVisualTree(object? sender, VisualTreeAttachmentEventArgs e)
    {
        _conversationSearchCancellation?.Cancel();
        _conversationSearchCancellation?.Dispose();
        _conversationSearchCancellation = null;
        _reloadCancellation?.Cancel();
    }

    public async Task ReloadAsync()
    {
        var previous = _reloadCancellation;
        var current = new CancellationTokenSource();
        _reloadCancellation = current;
        previous?.Cancel();
        previous?.Dispose();
        Background = _brush("BaseBrush");
        _scroll.Background = _brush("BaseBrush");
        _root.Children.Clear();
        _conversation.Children.Clear();
        _conversationTurns.Clear();
        _conversationTotal = 0;
        _nextConversationBatch = 50;
        _status.Text = "Loading session summary…";
        _status.Foreground = _brush("SecondaryBrush");
        _status.IsVisible = true;
        try
        {
            await LoadAsync(current.Token);
        }
        catch (OperationCanceledException) when (current.IsCancellationRequested)
        {
            // A newer theme reload owns the visual tree now.
        }
    }

    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        _root.Children.Add(_status);
        try
        {
            var previewTask = _api.GetPreviewAsync(_session.Id, cancellationToken, ProviderId);
            var configTask = _api.GetConfigAsync(_session.Id, cancellationToken, ProviderId);
            var contextTask = _api.GetContextAsync(_session.Id, cancellationToken, ProviderId);
            await Task.WhenAll(previewTask, configTask, contextTask);
            cancellationToken.ThrowIfCancellationRequested();
            var preview = previewTask.Result;
            var config = configTask.Result;
            var context = contextTask.Result;
            _status.IsVisible = false;

            _root.Children.Add(Header(preview));
            _root.Children.Add(Actions(preview));
            _root.Children.Add(BillingSummary(preview));
            _root.Children.Add(Metrics(preview));
            _root.Children.Add(ContextComposition(context));
            _root.Children.Add(Details(preview, config));
            if (preview.ModelSwitches.Count > 0) _root.Children.Add(ModelHistory(preview));
            if (preview.SubagentCount > 0)
            {
                await LoadSubagentsAsync(cancellationToken);
            }
            _root.Children.Add(SectionTitle("CONVERSATION"));
            _root.Children.Add(ConversationToolbar());
            _root.Children.Add(_conversation);
            await LoadConversationAsync(ConversationLoad.Reset, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _status.Text = $"Summary unavailable: {ex.Message}";
            _status.Foreground = _brush("ErrorBrush");
        }
    }

    private Control Header(SessionPreviewData preview)
    {
        var panel = new StackPanel { Spacing = 5 };
        panel.Children.Add(new TextBlock
        {
            Text = preview.DisplayTitle,
            FontSize = 22,
            FontWeight = FontWeight.Bold,
            Foreground = _brush("PrimaryBrush"),
            TextWrapping = TextWrapping.Wrap,
        });
        panel.Children.Add(new TextBlock
        {
            Text = $"{preview.Status}  ·  {preview.CurrentModel}  ·  reasoning {preview.ReasoningEffort}  ·  {preview.PermissionMode}",
            Foreground = _brush("AccentBrush"),
            TextWrapping = TextWrapping.Wrap,
        });
        panel.Children.Add(new TextBlock
        {
            Text = $"{preview.Id}  ·  {preview.WorkingDir}  ·  {preview.BackendType}" +
                   (string.IsNullOrWhiteSpace(preview.GitBranch) ? string.Empty : $"  ·  {preview.GitBranch} @ {preview.GitSha[..Math.Min(8, preview.GitSha.Length)]}"),
            Foreground = _brush("SecondaryBrush"),
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
        });
        if (preview.IsHeadless)
        {
            panel.Children.Add(new TextBlock
            {
                Text = "Headless run: no live terminal is available; transcript and telemetry remain accessible here.",
                Foreground = _brush("AccentBrush"),
                FontWeight = FontWeight.SemiBold,
                Margin = new Thickness(0, 5, 0, 0),
            });
        }
        return panel;
    }

    private Control Actions(SessionPreviewData preview)
    {
        var title = new TextBox
        {
            Text = preview.DisplayTitle,
            Width = 320,
            MinWidth = 220,
            PlaceholderText = "Session title",
            Margin = new Thickness(0, 0, 7, 7),
        };
        var status = new TextBlock
        {
            Foreground = _brush("SecondaryBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(4, 0, 4, 7),
        };
        var rename = new Button { Content = "Rename", Padding = new Thickness(11, 5), Margin = new Thickness(0, 0, 7, 7) };
        var archive = new Button
        {
            Content = preview.Archived ? "Restore" : "Archive",
            Padding = new Thickness(11, 5),
            Margin = new Thickness(0, 0, 7, 7),
        };
        var resume = new Button
        {
            Content = "Resume terminal",
            Padding = new Thickness(11, 5),
            Margin = new Thickness(0, 0, 7, 7),
            IsVisible = !preview.IsHeadless && !preview.Archived,
        };
        var confirmArchive = false;

        async Task CommitRenameAsync()
        {
            var next = title.Text?.Trim();
            if (string.IsNullOrWhiteSpace(next) || next == _session.DisplayTitle) return;
            await RunActionAsync(rename, status, "Renaming…", async () =>
            {
                await _rename(next);
                _session.Title = next;
                status.Text = "Renamed";
            });
        }
        rename.Click += async (_, _) => await CommitRenameAsync();
        title.KeyDown += async (_, args) =>
        {
            if (args.Key != Avalonia.Input.Key.Enter) return;
            args.Handled = true;
            await CommitRenameAsync();
        };
        archive.Click += async (_, _) =>
        {
            if (preview.Archived)
            {
                await RunActionAsync(archive, status, "Restoring…", _restore);
                return;
            }
            if (!confirmArchive)
            {
                confirmArchive = true;
                archive.Content = "Confirm archive";
                archive.Foreground = _brush("ErrorBrush");
                status.Text = "Archive is reversible";
                return;
            }
            confirmArchive = false;
            await RunActionAsync(archive, status, "Archiving…", _archive);
        };
        archive.LostFocus += (_, _) =>
        {
            if (preview.Archived || !confirmArchive) return;
            confirmArchive = false;
            archive.Content = "Archive";
            archive.Foreground = _brush("PrimaryBrush");
            status.Text = string.Empty;
        };
        resume.Click += async (_, _) => await RunActionAsync(resume, status, "Opening terminal…", _resume);

        var wrap = new WrapPanel { Orientation = Orientation.Horizontal };
        wrap.Children.Add(title);
        wrap.Children.Add(rename);
        wrap.Children.Add(archive);
        wrap.Children.Add(resume);
        wrap.Children.Add(status);
        return new Border
        {
            Background = _brush("SurfaceBrush"),
            BorderBrush = _brush("BorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(10, 10, 3, 3),
            Child = wrap,
        };
    }

    private static async Task RunActionAsync(Button button, TextBlock status, string pending, Func<Task> action)
    {
        button.IsEnabled = false;
        status.Text = pending;
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            status.Text = ex.Message;
        }
        finally
        {
            button.IsEnabled = true;
        }
    }

    private Control Metrics(SessionPreviewData preview)
    {
        var wrap = new WrapPanel { Orientation = Orientation.Horizontal };
        AddMetric(wrap, "Created", preview.CreatedAtStr);
        AddMetric(wrap, "Duration", preview.DurationStr);
        AddMetric(wrap, "Last active", preview.LastActivityAgo);
        AddMetric(wrap, "User messages", preview.UserMsgCount.ToString("N0"));
        AddMetric(wrap, "Assistant", preview.AssistantMsgCount.ToString("N0"));
        AddMetric(wrap, "Tool calls", preview.ToolCallCount.ToString("N0"));
        AddMetric(wrap, "Compactions", preview.CompactionCount.ToString("N0"));
        AddMetric(wrap, "Nodes", preview.TotalNodes.ToString("N0"));
        AddMetric(wrap, "Peak context", FormatNumber(preview.PeakContextTokens));
        AddMetric(wrap, "Context window", FormatNumber(preview.ModelContextWindow));
        if (preview.CacheWriteTokens > 0) AddMetric(wrap, "Cache write", FormatNumber(preview.CacheWriteTokens));
        if (preview.UnclassifiedTokens > 0) AddMetric(wrap, "Unclassified", FormatNumber(preview.UnclassifiedTokens));
        AddMetric(wrap, "Model calls", preview.Calls.ToString("N0"));
        AddMetric(wrap, "Subagents", preview.SubagentCount.ToString("N0"));
        AddMetric(wrap, "Telemetry", string.IsNullOrWhiteSpace(preview.TokenTelemetrySource) ? "unknown" : preview.TokenTelemetrySource);
        return wrap;
    }

    private Control BillingSummary(SessionPreviewData preview)
    {
        var panel = new StackPanel { Spacing = 9 };
        panel.Children.Add(new TextBlock
        {
            Text = "TOKEN & CREDIT COST",
            FontSize = 16,
            FontWeight = FontWeight.Bold,
            Foreground = _brush("AccentBrush"),
        });
        panel.Children.Add(new TextBlock
        {
            Text = $"Session total · {preview.CurrentModel} · reasoning {preview.ReasoningEffort}",
            Foreground = _brush("SecondaryBrush"),
            FontSize = 11,
        });
        var metrics = new WrapPanel { Orientation = Orientation.Horizontal };
        AddBillingMetric(metrics, "FRESH INPUT", FormatNumber(preview.InputTokens), "full input rate");
        AddBillingMetric(metrics, "CACHED INPUT", FormatNumber(preview.CachedInputTokens), "discounted input rate");
        AddBillingMetric(metrics, "TOTAL INPUT", FormatNumber(preview.TotalInputTokens), "fresh + cached");
        AddBillingMetric(metrics, "TOTAL OUTPUT", FormatNumber(preview.OutputTokens), "includes reasoning");
        AddBillingMetric(metrics, "REASONING", FormatNumber(preview.ReasoningOutputTokens), "included in output");
        AddBillingMetric(metrics, "TOTAL TOKENS", FormatNumber(preview.TotalTokens), $"{preview.Calls:N0} model calls");
        AddBillingMetric(metrics, "EST. CREDITS", SessionCreditValue(preview), SessionPricingCoverage(preview));
        panel.Children.Add(metrics);
        panel.Children.Add(new TextBlock
        {
            Text = preview.UnpricedTokens > 0
                ? $"Partial estimate: {FormatNumber(preview.UnpricedTokens)} tokens use model rates absent from the public Codex rate card. " +
                  "Reasoning tokens use the output rate; the reasoning level does not add a separate published multiplier. " +
                  "This is a Standard-mode estimate because stored telemetry does not identify Fast mode."
                : "Reasoning tokens use the output-token rate and are already included in total output; the reasoning level does not add a separate published multiplier. " +
                  "This is a Standard-mode estimate because stored telemetry does not identify Fast mode.",
            Foreground = _brush("SecondaryBrush"),
            FontSize = 10,
            TextWrapping = TextWrapping.Wrap,
        });
        return new Border
        {
            Background = _brush("ElevatedBrush"),
            BorderBrush = _brush("AccentBrush"),
            BorderThickness = new Thickness(2),
            CornerRadius = new CornerRadius(7),
            Padding = new Thickness(14),
            Child = panel,
        };
    }

    private void AddBillingMetric(Panel panel, string label, string value, string detail)
    {
        panel.Children.Add(new Border
        {
            Width = 150,
            MinHeight = 72,
            Margin = new Thickness(0, 0, 7, 7),
            Padding = new Thickness(9, 7),
            Background = _brush("SurfaceBrush"),
            BorderBrush = _brush("BorderBrightBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Child = new StackPanel
            {
                Spacing = 2,
                Children =
                {
                    new TextBlock { Text = value, FontSize = 18, FontWeight = FontWeight.Bold, Foreground = _brush("PrimaryBrush") },
                    new TextBlock { Text = label, FontSize = 9, FontWeight = FontWeight.Bold, Foreground = _brush("AccentBrush") },
                    new TextBlock { Text = detail, FontSize = 9, Foreground = _brush("MutedBrush"), TextWrapping = TextWrapping.Wrap },
                },
            },
        });
    }

    private static string SessionCreditValue(SessionPreviewData preview)
    {
        if (preview.TotalTokens <= 0) return "0";
        return preview.PricedTokens > 0 ? $"~{preview.EstimatedCredits:0.###}" : "—";
    }

    private static string SessionPricingCoverage(SessionPreviewData preview)
    {
        if (preview.TotalTokens <= 0) return "no token usage";
        return preview.PricedTokens > 0
            ? $"{preview.PricingCoverage:P0} pricing coverage"
            : "rate not publicly priced";
    }

    private Control Details(SessionPreviewData preview, SessionConfigData config)
    {
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*"), ColumnSpacing = 12 };
        var tools = Card("TOP TOOLS", preview.TopTools.Count == 0
            ? ["No tool telemetry"]
            : preview.TopTools.Select(tool => $"{tool.Name}   {tool.Count:N0} calls"));
        var permissions = config.Permissions.Select(permission =>
            string.IsNullOrWhiteSpace(permission.Label)
                ? $"{permission.Scope}: {permission.Action}"
                : permission.Label).Distinct().ToList();
        var configLines = new List<string>
        {
            $"Model: {preview.StartingModel} → {preview.CurrentModel}",
            $"Reasoning: {preview.ReasoningEffort}",
            $"Permissions: {(permissions.Count == 0 ? "not reported" : string.Join(", ", permissions))}",
            $"Project total: {preview.ProjectDurationStr}",
        };
        if (preview.RateLimits is not null)
        {
            configLines.Add($"Quota: {RateLimitSummary(preview.RateLimits)}");
        }
        var configuration = ConfigurationCard(configLines, config);
        grid.Children.Add(tools);
        grid.Children.Add(configuration);
        Grid.SetColumn(configuration, 1);
        grid.SizeChanged += (_, args) => ReflowGrid(grid, args.NewSize.Width >= 680 ? 2 : 1);
        return grid;
    }

    private Control ConfigurationCard(IEnumerable<string> lines, SessionConfigData config)
    {
        var panel = new StackPanel { Spacing = 7 };
        panel.Children.Add(SectionTitle("CONFIGURATION"));
        foreach (var line in lines)
            panel.Children.Add(new TextBlock { Text = line, Foreground = _brush("SecondaryBrush"), TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(ConfigItems("RULES", config.Rules.Select(rule => string.IsNullOrWhiteSpace(rule.Name) ? rule.Path : rule.Name), "No injected rules"));
        panel.Children.Add(ConfigItems("ACTIVE SKILLS", config.ActiveSkills.Select(skill => skill.Name), "No active skills recorded"));
        return new Border
        {
            Background = _brush("SurfaceBrush"),
            BorderBrush = _brush("BorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(12),
            Child = panel,
        };
    }

    private Control ConfigItems(string heading, IEnumerable<string> values, string emptyText)
    {
        var items = values.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var panel = new StackPanel { Spacing = 4 };
        panel.Children.Add(new TextBlock { Text = heading, Foreground = _brush("MutedBrush"), FontSize = 10, FontWeight = FontWeight.Bold });
        if (items.Count == 0)
        {
            panel.Children.Add(new TextBlock { Text = emptyText, Foreground = _brush("MutedBrush"), FontSize = 11 });
            return panel;
        }
        var wrap = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var item in items)
        {
            wrap.Children.Add(new Border
            {
                Background = _brush("ElevatedBrush"),
                BorderBrush = _brush("BorderBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(7, 3),
                Margin = new Thickness(0, 0, 5, 5),
                Child = new TextBlock { Text = item, Foreground = _brush("AccentBrush"), FontSize = 10 },
            });
        }
        panel.Children.Add(wrap);
        return panel;
    }

    private Control ModelHistory(SessionPreviewData preview)
    {
        var panel = new StackPanel { Spacing = 6 };
        panel.Children.Add(SectionTitle("MODEL & REASONING CHANGES"));
        panel.Children.Add(new TextBlock
        {
            Text = $"Started on {preview.StartingModel}",
            Foreground = _brush("SecondaryBrush"),
        });
        foreach (var change in preview.ModelSwitches)
        {
            var timestamp = change.Timestamp is long epoch
                ? DateTimeOffset.FromUnixTimeSeconds(epoch).ToLocalTime().ToString("MMM d · HH:mm")
                : "time unknown";
            panel.Children.Add(new TextBlock
            {
                Text = $"{timestamp}   {change.FromModel} · {change.FromReasoningEffort}  →  {change.Model} · {change.ReasoningEffort}",
                Foreground = _brush("PrimaryBrush"),
                TextWrapping = TextWrapping.Wrap,
            });
        }
        return new Border
        {
            Background = _brush("SurfaceBrush"),
            BorderBrush = _brush("BorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(12),
            Child = panel,
        };
    }

    private Control ConversationToolbar()
    {
        _conversationCount.Foreground = _brush("SecondaryBrush");
        return _conversationToolbar;
    }

    private async Task LoadConversationAsync(ConversationLoad mode, CancellationToken cancellationToken)
    {
        try
        {
            _loadMoreButton.IsEnabled = false;
            _loadAllButton.IsEnabled = false;
            var offset = mode == ConversationLoad.More ? _conversationTurns.Count : 0;
            var limit = mode switch
            {
                ConversationLoad.All => 0,
                ConversationLoad.More => _nextConversationBatch,
                _ => 50,
            };
            _conversationCount.Text = mode switch
            {
                ConversationLoad.All => "Loading complete conversation…",
                ConversationLoad.More => "Loading older exchanges…",
                _ => "Loading recent conversation…",
            };
            var data = await _api.GetConversationAsync(
                _session.Id, offset, limit, cancellationToken, ProviderId);
            cancellationToken.ThrowIfCancellationRequested();
            if (mode == ConversationLoad.More)
            {
                _conversationTurns.InsertRange(0, data.Turns);
                _nextConversationBatch = Math.Min(400, _nextConversationBatch * 2);
            }
            else
            {
                _conversationTurns.Clear();
                _conversationTurns.AddRange(data.Turns);
            }
            _conversationTotal = data.TotalTurns;
            RenderConversation();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _conversation.Children.Clear();
            _conversation.Children.Add(new TextBlock { Text = $"Conversation unavailable: {ex.Message}", Foreground = _brush("SecondaryBrush") });
        }
        finally
        {
            _loadMoreButton.IsEnabled = true;
            _loadAllButton.IsEnabled = true;
        }
    }

    private void RenderConversation()
    {
        _conversation.Children.Clear();
        var query = ConversationSearch.Normalize(_conversationSearch.Text);
        var visible = string.IsNullOrWhiteSpace(query)
            ? _conversationTurns
            : [.. _conversationTurns.Where(turn =>
                ConversationSearch.Matches(query, turn.UserText, turn.AssistantText))];
        foreach (var turn in visible)
        {
            if (!string.IsNullOrWhiteSpace(turn.UserText))
                _conversation.Children.Add(MessageBubble("YOU", turn.UserText, true, turn.CreatedAt));
            if (!string.IsNullOrWhiteSpace(turn.AssistantText))
                _conversation.Children.Add(MessageBubble(ProviderLabel, turn.AssistantText, false, turn.AssistantCreatedAt));
        }
        if (visible.Count == 0)
        {
            _conversation.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(query) ? "No conversation text recorded." : $"No loaded exchanges match “{query}”.",
                Foreground = _brush("MutedBrush"),
            });
        }
        var hasMore = _conversationTurns.Count < _conversationTotal;
        _loadMoreButton.IsVisible = hasMore;
        _loadAllButton.IsVisible = hasMore;
        _loadMoreButton.Content = $"Load {Math.Min(_nextConversationBatch, Math.Max(0, _conversationTotal - _conversationTurns.Count)):N0} more";
        _loadAllButton.Content = $"Load all ({_conversationTotal:N0})";
        _conversationCount.Text = string.IsNullOrWhiteSpace(query)
            ? $"{_conversationTurns.Count:N0} of {_conversationTotal:N0} exchanges"
            : $"{visible.Count:N0} matching exchanges · {_conversationTurns.Count:N0} loaded";
    }

    private enum ConversationLoad
    {
        Reset,
        More,
        All,
    }

    private async Task LoadSubagentsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var subagents = await _api.GetSubagentsAsync(_session.Id, cancellationToken, ProviderId);
            cancellationToken.ThrowIfCancellationRequested();
            if (subagents.Count == 0) return;
            var completed = subagents.Count(subagent => subagent.Status.Equals("completed", StringComparison.OrdinalIgnoreCase));
            var panel = new StackPanel { Spacing = 8 };
            panel.Children.Add(SectionTitle("SUBAGENT TIMELINE"));
            panel.Children.Add(new TextBlock
            {
                Text = $"{subagents.Count:N0} delegated tasks · {completed:N0} completed · {subagents.Count - completed:N0} active or interrupted",
                Foreground = _brush("SecondaryBrush"),
                FontSize = 11,
            });
            for (var index = 0; index < subagents.Count; index++)
                panel.Children.Add(SubagentTimelineItem(subagents[index], index < subagents.Count - 1));
            _root.Children.Add(new Border
            {
                Background = _brush("SurfaceBrush"),
                BorderBrush = _brush("BorderBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12),
                Child = panel,
            });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            // Subagent telemetry is optional.
        }
    }

    private Control SubagentTimelineItem(SubagentData subagent, bool hasNext)
    {
        var accent = subagent.Status.Equals("completed", StringComparison.OrdinalIgnoreCase)
            ? _brush("AccentBrush")
            : Brush.Parse("#F59E0B");
        var timeline = new Grid { RowDefinitions = new RowDefinitions("Auto,*"), Width = 18 };
        timeline.Children.Add(new Ellipse
        {
            Width = 10,
            Height = 10,
            Fill = accent,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 7, 0, 0),
        });
        if (hasNext)
        {
            var line = new Border
            {
                Width = 2,
                MinHeight = 45,
                Background = _brush("BorderBrightBrush"),
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            timeline.Children.Add(line);
            Grid.SetRow(line, 1);
        }

        var heading = string.IsNullOrWhiteSpace(subagent.Title) ? subagent.Nickname : subagent.Title;
        var header = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), ColumnSpacing = 10 };
        header.Children.Add(new TextBlock
        {
            Text = heading,
            FontWeight = FontWeight.SemiBold,
            Foreground = _brush("PrimaryBrush"),
            TextWrapping = TextWrapping.Wrap,
        });
        var status = new Border
        {
            Background = _brush("ElevatedBrush"),
            BorderBrush = accent,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(7, 2),
            Child = new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(subagent.Status) ? "recorded" : subagent.Status,
                Foreground = accent,
                FontSize = 10,
                FontWeight = FontWeight.Bold,
            },
        };
        header.Children.Add(status);
        Grid.SetColumn(status, 1);

        var body = new StackPanel { Spacing = 4 };
        body.Children.Add(header);
        body.Children.Add(new TextBlock
        {
            Text = $"{subagent.Profile.Replace('_', ' ')} · {FormatDuration(subagent.DurationSec)} · {FormatTimestamp(subagent.StartedAt)}" +
                   (subagent.IsBackground ? " · background" : string.Empty),
            Foreground = _brush("SecondaryBrush"),
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
        });
        var detailLines = new List<string>();
        if (!string.IsNullOrWhiteSpace(subagent.Task)) detailLines.Add(subagent.Task);
        if (!string.IsNullOrWhiteSpace(subagent.ResultPreview)) detailLines.Add($"Result: {subagent.ResultPreview}");
        if (detailLines.Count > 0)
        {
            body.Children.Add(new Expander
            {
                Header = "Task & result",
                IsExpanded = false,
                Foreground = _brush("SecondaryBrush"),
                Content = new Border
                {
                    Background = _brush("ElevatedBrush"),
                    BorderBrush = _brush("BorderBrush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(9),
                    Child = new TextBlock
                    {
                        Text = string.Join("\n\n", detailLines),
                        Foreground = _brush("PrimaryBrush"),
                        TextWrapping = TextWrapping.Wrap,
                        MaxHeight = 220,
                    },
                },
            });
        }
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*"), ColumnSpacing = 8 };
        row.Children.Add(timeline);
        row.Children.Add(body);
        Grid.SetColumn(body, 1);
        return row;
    }

    private Control ContextComposition(SessionContextData context)
    {
        var segments = new (string Label, long Value, IBrush Brush)[]
        {
            ("System prompt", context.Categories.SystemPrompt, Brush.Parse("#38BDF8")),
            ("User messages", context.Categories.UserMessages, Brush.Parse("#8B5CF6")),
            ("Assistant messages", context.Categories.AssistantMessages, _brush("AccentBrush")),
            ("Tool calls", context.Categories.ToolCalls, Brush.Parse("#F59E0B")),
            ("Tool results", context.Categories.ToolResults, _brush("ErrorBrush")),
            ("Free", context.FreeTokens, _brush("BorderBrightBrush")),
        };
        var donut = new ContextDonutControl
        {
            Width = 138,
            Height = 138,
            HorizontalAlignment = HorizontalAlignment.Center,
            SegmentBrushes = [.. segments.Select(segment => segment.Brush)],
        };
        donut.SetData(segments.Select(segment => (segment.Label, segment.Value)));
        var legend = new StackPanel { Spacing = 5, VerticalAlignment = VerticalAlignment.Center };
        var total = Math.Max(1, context.MaxContext);
        foreach (var segment in segments)
        {
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto"), ColumnSpacing = 7 };
            row.Children.Add(new Ellipse { Width = 8, Height = 8, Fill = segment.Brush, VerticalAlignment = VerticalAlignment.Center });
            var label = new TextBlock { Text = segment.Label, Foreground = _brush("SecondaryBrush") };
            var value = new TextBlock
            {
                Text = $"{FormatNumber(segment.Value)}  {segment.Value * 100d / total:0.#}%",
                Foreground = _brush("PrimaryBrush"),
                FontFamily = new FontFamily("Cascadia Mono, Consolas"),
            };
            row.Children.Add(label);
            row.Children.Add(value);
            Grid.SetColumn(label, 1);
            Grid.SetColumn(value, 2);
            legend.Children.Add(row);
        }
        var contents = new Grid { ColumnDefinitions = new ColumnDefinitions("170,*"), ColumnSpacing = 10 };
        contents.Children.Add(donut);
        contents.Children.Add(legend);
        Grid.SetColumn(legend, 1);
        contents.SizeChanged += (_, args) => ReflowGrid(contents, args.NewSize.Width >= 480 ? 2 : 1);
        var panel = new StackPanel { Spacing = 8 };
        panel.Children.Add(SectionTitle("CONTEXT COMPOSITION"));
        panel.Children.Add(new TextBlock
        {
            Text = $"{FormatNumber(context.TotalUsed)} used of {FormatNumber(context.MaxContext)} · {context.CompactionCount:N0} compactions · hover the ring for exact values",
            Foreground = _brush("SecondaryBrush"),
            FontSize = 11,
        });
        panel.Children.Add(contents);
        return new Border
        {
            Background = _brush("SurfaceBrush"),
            BorderBrush = _brush("BorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(12),
            Child = panel,
        };
    }

    private static string FormatDuration(long? seconds)
    {
        if (seconds is null) return "in progress";
        var value = TimeSpan.FromSeconds(seconds.Value);
        if (value.TotalHours >= 1) return $"{(int)value.TotalHours}h {value.Minutes}m";
        if (value.TotalMinutes >= 1) return $"{value.Minutes}m {value.Seconds}s";
        return $"{value.Seconds}s";
    }

    private static string FormatTimestamp(long? epoch) => epoch is long value
        ? DateTimeOffset.FromUnixTimeSeconds(value).ToLocalTime().ToString("MMM d · HH:mm:ss")
        : "start time unknown";

    private Control MessageBubble(string label, string text, bool user, long? timestamp)
    {
        var copy = new Button { Content = "Copy", Padding = new Thickness(8, 2), HorizontalAlignment = HorizontalAlignment.Right };
        copy.Click += async (_, _) =>
        {
            var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;
            if (clipboard is not null) await clipboard.SetTextAsync(text);
        };
        var panel = new StackPanel { Spacing = 5 };
        var header = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        var time = timestamp is long epoch
            ? DateTimeOffset.FromUnixTimeSeconds(epoch).ToLocalTime().ToString("MMM d · HH:mm:ss")
            : string.Empty;
        header.Children.Add(new TextBlock
        {
            Text = string.IsNullOrEmpty(time) ? label : $"{label}   {time}",
            FontWeight = FontWeight.Bold,
            Foreground = _brush(user ? "AccentBrush" : "SecondaryBrush"),
        });
        header.Children.Add(copy);
        Grid.SetColumn(copy, 1);
        panel.Children.Add(header);
        panel.Children.Add(RichMessageContent(text));
        return new Border
        {
            Background = _brush(user ? "ElevatedBrush" : "SurfaceBrush"),
            BorderBrush = _brush("BorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(12),
            HorizontalAlignment = user ? HorizontalAlignment.Right : HorizontalAlignment.Stretch,
            MaxWidth = user ? 920 : double.PositiveInfinity,
            Child = panel,
        };
    }

    private Control RichMessageContent(string text)
    {
        var panel = new StackPanel { Spacing = 7 };
        var parts = text.Replace("\r\n", "\n").Split("```", StringSplitOptions.None);
        for (var index = 0; index < parts.Length; index++)
        {
            if (string.IsNullOrEmpty(parts[index])) continue;
            if (index % 2 == 1)
            {
                var code = parts[index];
                var firstBreak = code.IndexOf('\n');
                if (firstBreak >= 0 && firstBreak < 30 && !code[..firstBreak].Contains(' ')) code = code[(firstBreak + 1)..];
                panel.Children.Add(new Border
                {
                    Background = _brush("TerminalBrush"),
                    BorderBrush = _brush("BorderBrush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(10),
                    Child = new TextBlock
                    {
                        Text = code.TrimEnd(),
                        FontFamily = new FontFamily("Cascadia Mono, Consolas"),
                        Foreground = _brush("PrimaryBrush"),
                        TextWrapping = TextWrapping.Wrap,
                    },
                });
            }
            else
            {
                foreach (var paragraph in parts[index].Split("\n\n", StringSplitOptions.RemoveEmptyEntries))
                {
                    panel.Children.Add(new TextBlock
                    {
                        Text = paragraph.Trim(),
                        TextWrapping = TextWrapping.Wrap,
                        Foreground = _brush("PrimaryBrush"),
                        LineHeight = 20,
                    });
                }
            }
        }
        return panel;
    }

    private static string RateLimitSummary(RateLimitInfo rateLimits)
    {
        var window = rateLimits.Primary ?? rateLimits.Secondary;
        var usage = window is null ? "no active window" : $"{window.UsedPercent:0.#}% used / {window.WindowMinutes:N0}m";
        var credits = rateLimits.Credits?.Unlimited == true ? "unlimited credits" : "metered credits";
        return $"{rateLimits.PlanType ?? "unknown"} · {usage} · {credits}";
    }

    private Control Card(string heading, IEnumerable<string> lines)
    {
        var panel = new StackPanel { Spacing = 5 };
        panel.Children.Add(SectionTitle(heading));
        foreach (var line in lines)
        {
            panel.Children.Add(new TextBlock { Text = line, Foreground = _brush("SecondaryBrush"), TextWrapping = TextWrapping.Wrap });
        }
        return new Border
        {
            Background = _brush("SurfaceBrush"),
            BorderBrush = _brush("BorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(12),
            Child = panel,
        };
    }

    private TextBlock SectionTitle(string text) => new()
    {
        Text = text,
        FontWeight = FontWeight.Bold,
        Foreground = _brush("AccentBrush"),
    };

    private void AddMetric(Panel panel, string label, string value)
    {
        var stack = new StackPanel { Spacing = 2 };
        stack.Children.Add(new TextBlock { Text = value, FontWeight = FontWeight.Bold, Foreground = _brush("PrimaryBrush") });
        stack.Children.Add(new TextBlock { Text = label, FontSize = 10, Foreground = _brush("MutedBrush") });
        panel.Children.Add(new Border
        {
            Background = _brush("ElevatedBrush"),
            BorderBrush = _brush("BorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(5),
            Padding = new Thickness(10, 7),
            Margin = new Thickness(0, 0, 7, 7),
            MinWidth = 105,
            Child = stack,
        });
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

    private static string FormatNumber(long value) => value switch
    {
        >= 1_000_000_000 => $"{value / 1_000_000_000d:0.##}B",
        >= 1_000_000 => $"{value / 1_000_000d:0.##}M",
        >= 1_000 => $"{value / 1_000d:0.##}K",
        _ => value.ToString("N0"),
    };
}
