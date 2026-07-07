using Avalonia;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Threading;

namespace CodexNative;

internal static class ChartFormat
{
    public static string Number(double value) => value switch
    {
        >= 1_000_000_000 => $"{value / 1_000_000_000d:0.##}B",
        >= 1_000_000 => $"{value / 1_000_000d:0.##}M",
        >= 1_000 => $"{value / 1_000d:0.##}K",
        _ => $"{value:N0}",
    };
}

internal static class ChartAccessibility
{
    public static void Describe(Control control, string text)
    {
        ToolTip.SetTip(control, text);
        AutomationProperties.SetItemStatus(control, text.Replace('\n', ' '));
    }

    public static void DrawFocus(DrawingContext context, Control control)
    {
        if (!control.IsFocused || control.Bounds.Width <= 2 || control.Bounds.Height <= 2) return;
        context.DrawRectangle(null, new Pen(Brushes.White, 1.5), new Rect(1, 1, control.Bounds.Width - 2, control.Bounds.Height - 2));
    }
}

public abstract class AccessibleChartControl : Control
{
    protected override AutomationPeer OnCreateAutomationPeer() => new ControlAutomationPeer(this);
}

public sealed class TokenActivityChart : AccessibleChartControl
{
    private long[] _targetInput = [];
    private long[] _targetOutput = [];
    private double[] _displayInput = [];
    private double[] _displayOutput = [];
    private readonly DispatcherTimer _animation;
    private int _hovered = -1;
    private int _frame;

    public IBrush InputBrush { get; set; } = Brush.Parse("#38BDF8");
    public IBrush OutputBrush { get; set; } = Brush.Parse("#00FFA3");
    public IBrush GridBrush { get; set; } = Brush.Parse("#1E2D3D");

    public TokenActivityChart()
    {
        MinHeight = 170;
        ClipToBounds = true;
        Focusable = true;
        AutomationProperties.SetName(this, "Token activity by hour");
        AutomationProperties.SetHelpText(this, "Use Left and Right arrow keys to inspect hourly input and output tokens.");
        _animation = new DispatcherTimer(TimeSpan.FromMilliseconds(16), DispatcherPriority.Render, (_, _) => Animate());
        PointerMoved += OnPointerMoved;
        PointerExited += (_, _) => { if (!IsFocused) { _hovered = -1; ToolTip.SetTip(this, null); InvalidateVisual(); } };
        GotFocus += (_, _) => SetHovered(_hovered >= 0 ? _hovered : 0);
        LostFocus += (_, _) => { _hovered = -1; ToolTip.SetTip(this, null); InvalidateVisual(); };
        KeyDown += OnKeyDown;
    }

    public void SetData(IReadOnlyList<long>? input, IReadOnlyList<long>? output)
    {
        _targetInput = (input ?? []).ToArray();
        _targetOutput = (output ?? []).ToArray();
        var count = Math.Max(_targetInput.Length, _targetOutput.Length);
        if (_displayInput.Length != count) _displayInput = new double[count];
        if (_displayOutput.Length != count) _displayOutput = new double[count];
        _frame = 0;
        _animation.Start();
    }

    private void Animate()
    {
        _frame++;
        for (var index = 0; index < _displayInput.Length; index++)
        {
            _displayInput[index] += ((index < _targetInput.Length ? _targetInput[index] : 0) - _displayInput[index]) * .24;
            _displayOutput[index] += ((index < _targetOutput.Length ? _targetOutput[index] : 0) - _displayOutput[index]) * .24;
        }
        InvalidateVisual();
        if (_frame >= 22)
        {
            for (var index = 0; index < _displayInput.Length; index++)
            {
                _displayInput[index] = index < _targetInput.Length ? _targetInput[index] : 0;
                _displayOutput[index] = index < _targetOutput.Length ? _targetOutput[index] : 0;
            }
            _animation.Stop();
        }
    }

    private void OnPointerMoved(object? sender, PointerEventArgs args)
    {
        var count = Math.Max(_targetInput.Length, _targetOutput.Length);
        if (count == 0 || Bounds.Width <= 0) return;
        SetHovered(Math.Clamp((int)(args.GetPosition(this).X / (Bounds.Width / count)), 0, count - 1));
    }

    private void OnKeyDown(object? sender, KeyEventArgs args)
    {
        var count = Math.Max(_targetInput.Length, _targetOutput.Length);
        if (count == 0) return;
        var next = args.Key switch
        {
            Key.Left or Key.Up => Math.Max(0, (_hovered < 0 ? 0 : _hovered) - 1),
            Key.Right or Key.Down => Math.Min(count - 1, Math.Max(0, _hovered) + 1),
            Key.Home => 0,
            Key.End => count - 1,
            _ => -1,
        };
        if (next < 0) return;
        args.Handled = true;
        SetHovered(next);
    }

    private void SetHovered(int index)
    {
        var count = Math.Max(_targetInput.Length, _targetOutput.Length);
        if (count == 0) return;
        _hovered = Math.Clamp(index, 0, count - 1);
        var input = _hovered < _targetInput.Length ? _targetInput[_hovered] : 0;
        var output = _hovered < _targetOutput.Length ? _targetOutput[_hovered] : 0;
        ChartAccessibility.Describe(this, $"{_hovered:00}:00–{(_hovered + 1) % 24:00}:00\nInput {ChartFormat.Number(input)}\nOutput {ChartFormat.Number(output)}");
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var width = Bounds.Width;
        var height = Bounds.Height;
        if (width <= 0 || height <= 0) return;
        for (var row = 1; row < 4; row++)
        {
            var y = height * row / 4;
            context.DrawLine(new Pen(GridBrush, 1), new Point(0, y), new Point(width, y));
        }
        var count = Math.Max(_displayInput.Length, _displayOutput.Length);
        if (count == 0) return;
        var inputMax = Math.Max(1, _displayInput.DefaultIfEmpty().Max());
        var outputMax = Math.Max(1, _displayOutput.DefaultIfEmpty().Max());
        var slot = width / count;
        var barWidth = Math.Max(2, slot * .34);
        for (var index = 0; index < count; index++)
        {
            if (index == _hovered)
                context.DrawRectangle(new SolidColorBrush(Color.FromArgb(24, 255, 255, 255)), null, new Rect(index * slot, 0, slot, height));
            var input = index < _displayInput.Length ? _displayInput[index] : 0;
            var output = index < _displayOutput.Length ? _displayOutput[index] : 0;
            var inputHeight = (height - 6) * input / inputMax;
            var outputHeight = (height - 6) * output / outputMax;
            var x = index * slot + Math.Max(0, (slot - barWidth * 2) / 2);
            context.DrawRectangle(InputBrush, null, new Rect(x, height - inputHeight, barWidth, inputHeight));
            context.DrawRectangle(OutputBrush, null, new Rect(x + barWidth + 1, height - outputHeight, barWidth, outputHeight));
        }
        ChartAccessibility.DrawFocus(context, this);
    }
}

public sealed class TokenHeatmapControl : AccessibleChartControl
{
    private IReadOnlyList<IReadOnlyList<long>> _values = [];
    private int _hoveredRow = -1;
    private int _hoveredColumn = -1;
    public Color AccentColor { get; set; } = Color.Parse("#00FFA3");
    public IBrush EmptyBrush { get; set; } = Brush.Parse("#131A22");

    public TokenHeatmapControl()
    {
        MinHeight = 112;
        Focusable = true;
        AutomationProperties.SetName(this, "Weekday and hour token heatmap");
        AutomationProperties.SetHelpText(this, "Use arrow keys to inspect token usage by weekday and hour.");
        PointerMoved += OnPointerMoved;
        PointerExited += (_, _) => { if (!IsFocused) { _hoveredRow = _hoveredColumn = -1; ToolTip.SetTip(this, null); InvalidateVisual(); } };
        GotFocus += (_, _) => SetHovered(Math.Max(0, _hoveredRow), Math.Max(0, _hoveredColumn));
        LostFocus += (_, _) => { _hoveredRow = _hoveredColumn = -1; ToolTip.SetTip(this, null); InvalidateVisual(); };
        KeyDown += OnKeyDown;
    }

    public void SetData(IReadOnlyList<IReadOnlyList<long>> values)
    {
        _values = values;
        InvalidateVisual();
    }

    private void OnPointerMoved(object? sender, PointerEventArgs args)
    {
        if (_values.Count == 0) return;
        var point = args.GetPosition(this);
        var columns = Math.Max(1, _values.Max(row => row.Count));
        SetHovered(
            Math.Clamp((int)(point.Y / Math.Max(1, Bounds.Height / _values.Count)), 0, _values.Count - 1),
            Math.Clamp((int)(point.X / Math.Max(1, Bounds.Width / columns)), 0, columns - 1));
    }

    private void OnKeyDown(object? sender, KeyEventArgs args)
    {
        if (_values.Count == 0) return;
        var columns = Math.Max(1, _values.Max(row => row.Count));
        var row = Math.Max(0, _hoveredRow);
        var column = Math.Max(0, _hoveredColumn);
        switch (args.Key)
        {
            case Key.Left: column = Math.Max(0, column - 1); break;
            case Key.Right: column = Math.Min(columns - 1, column + 1); break;
            case Key.Up: row = Math.Max(0, row - 1); break;
            case Key.Down: row = Math.Min(_values.Count - 1, row + 1); break;
            case Key.Home: column = 0; break;
            case Key.End: column = columns - 1; break;
            default: return;
        }
        args.Handled = true;
        SetHovered(row, column);
    }

    private void SetHovered(int row, int column)
    {
        if (_values.Count == 0) return;
        _hoveredRow = Math.Clamp(row, 0, _values.Count - 1);
        var columns = Math.Max(1, _values.Max(values => values.Count));
        _hoveredColumn = Math.Clamp(column, 0, columns - 1);
        var value = _hoveredColumn < _values[_hoveredRow].Count ? _values[_hoveredRow][_hoveredColumn] : 0;
        var day = new[] { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" }[_hoveredRow % 7];
        ChartAccessibility.Describe(this, $"{day} · {_hoveredColumn:00}:00\n{ChartFormat.Number(value)} tokens");
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_values.Count == 0 || Bounds.Width <= 0 || Bounds.Height <= 0) return;
        var rows = _values.Count;
        var columns = Math.Max(1, _values.Max(row => row.Count));
        var gap = 2d;
        var cellWidth = Math.Max(2, (Bounds.Width - gap * (columns - 1)) / columns);
        var cellHeight = Math.Max(2, (Bounds.Height - gap * (rows - 1)) / rows);
        var maximum = Math.Max(1, _values.SelectMany(row => row).DefaultIfEmpty().Max());
        for (var row = 0; row < rows; row++)
        for (var column = 0; column < _values[row].Count; column++)
        {
            var value = _values[row][column];
            IBrush fill = EmptyBrush;
            if (value > 0)
            {
                var intensity = .18 + .82 * Math.Sqrt(value / (double)maximum);
                fill = new SolidColorBrush(Color.FromArgb(255,
                    (byte)(AccentColor.R * intensity),
                    (byte)(AccentColor.G * intensity),
                    (byte)(AccentColor.B * intensity)));
            }
            var rect = new Rect(column * (cellWidth + gap), row * (cellHeight + gap), cellWidth, cellHeight);
            context.DrawRectangle(fill, null, rect);
            if (row == _hoveredRow && column == _hoveredColumn)
                context.DrawRectangle(null, new Pen(Brushes.White, 1.5), rect.Inflate(1));
        }
        ChartAccessibility.DrawFocus(context, this);
    }
}

public sealed class StackedTokenBar : AccessibleChartControl
{
    private long[] _values = [];
    private readonly string[] _labels = ["visible output", "reasoning", "fresh input", "cached input", "cache write", "unclassified"];
    private int _hovered = -1;
    public IReadOnlyList<IBrush> SegmentBrushes { get; set; } =
    [
        Brush.Parse("#00FFA3"), Brush.Parse("#FF8A4C"), Brush.Parse("#38BDF8"),
        Brush.Parse("#8B5CF6"), Brush.Parse("#EAB308"), Brush.Parse("#64748B")
    ];

    public StackedTokenBar()
    {
        MinHeight = 8;
        Focusable = true;
        AutomationProperties.SetName(this, "Token composition");
        AutomationProperties.SetHelpText(this, "Use Left and Right arrow keys to inspect visible token categories.");
        PointerMoved += OnPointerMoved;
        PointerExited += (_, _) => { if (!IsFocused) { _hovered = -1; ToolTip.SetTip(this, null); InvalidateVisual(); } };
        GotFocus += (_, _) => SetHovered(NextVisible(-1, 1));
        LostFocus += (_, _) => { _hovered = -1; ToolTip.SetTip(this, null); InvalidateVisual(); };
        KeyDown += OnKeyDown;
    }

    public void SetData(params long[] values)
    {
        _values = values;
        InvalidateVisual();
    }

    private void OnPointerMoved(object? sender, PointerEventArgs args)
    {
        var total = _values.Sum();
        if (total <= 0) return;
        var target = args.GetPosition(this).X / Math.Max(1, Bounds.Width) * total;
        long sum = 0;
        _hovered = -1;
        for (var index = 0; index < _values.Length; index++)
        {
            sum += _values[index];
            if (target <= sum) { _hovered = index; break; }
        }
        SetHovered(_hovered);
    }

    private void OnKeyDown(object? sender, KeyEventArgs args)
    {
        var direction = args.Key switch
        {
            Key.Left or Key.Up => -1,
            Key.Right or Key.Down => 1,
            Key.Home => 2,
            Key.End => -2,
            _ => 0,
        };
        if (direction == 0) return;
        args.Handled = true;
        var start = direction == 2 ? -1 : direction == -2 ? _values.Length : _hovered;
        SetHovered(NextVisible(start, direction > 0 ? 1 : -1));
    }

    private int NextVisible(int start, int direction)
    {
        for (var index = start + direction; index >= 0 && index < _values.Length; index += direction)
            if (_values[index] > 0) return index;
        return Math.Clamp(start, 0, Math.Max(0, _values.Length - 1));
    }

    private void SetHovered(int index)
    {
        if (_values.Length == 0 || index < 0 || index >= _values.Length || _values[index] <= 0) return;
        _hovered = index;
        var total = _values.Sum();
        ChartAccessibility.Describe(this, $"{_labels.ElementAtOrDefault(_hovered) ?? "tokens"}\n{ChartFormat.Number(_values[_hovered])} · {_values[_hovered] * 100d / Math.Max(1, total):0.#}%");
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var total = _values.Sum();
        if (total <= 0) return;
        var x = 0d;
        for (var index = 0; index < _values.Length; index++)
        {
            var width = Bounds.Width * _values[index] / total;
            var rect = new Rect(x, index == _hovered ? 0 : 1, width, index == _hovered ? Bounds.Height : Math.Max(1, Bounds.Height - 2));
            context.DrawRectangle(SegmentBrushes[index % SegmentBrushes.Count], null, rect);
            x += width;
        }
        ChartAccessibility.DrawFocus(context, this);
    }
}

public sealed class ProjectComboChart : AccessibleChartControl
{
    private IReadOnlyList<ProjectStats> _projects = [];
    private double _progress = 1;
    private readonly DispatcherTimer _animation;
    private int _hovered = -1;
    public IBrush MessagesBrush { get; set; } = Brush.Parse("#38BDF8");
    public IBrush DurationBrush { get; set; } = Brush.Parse("#F59E0B");
    public IBrush SessionsBrush { get; set; } = Brush.Parse("#00FFA3");
    public IBrush GridBrush { get; set; } = Brush.Parse("#1E2D3D");
    public bool ShowMessages { get; set; } = true;
    public bool ShowDuration { get; set; } = true;
    public bool ShowSessions { get; set; } = true;

    public ProjectComboChart()
    {
        MinHeight = 150;
        Focusable = true;
        AutomationProperties.SetName(this, "Project activity chart");
        AutomationProperties.SetHelpText(this, "Use Left and Right arrow keys to inspect projects. Toggle series with the buttons below the chart.");
        _animation = new DispatcherTimer(TimeSpan.FromMilliseconds(16), DispatcherPriority.Render, (sender, _) =>
        {
            _progress = Math.Min(1, _progress + .07);
            InvalidateVisual();
            if (_progress >= 1 && sender is DispatcherTimer timer) timer.Stop();
        });
        PointerMoved += OnPointerMoved;
        PointerExited += (_, _) => { if (!IsFocused) { _hovered = -1; ToolTip.SetTip(this, null); InvalidateVisual(); } };
        GotFocus += (_, _) => SetHovered(_hovered >= 0 ? _hovered : 0);
        LostFocus += (_, _) => { _hovered = -1; ToolTip.SetTip(this, null); InvalidateVisual(); };
        KeyDown += OnKeyDown;
    }

    public void SetData(IReadOnlyList<ProjectStats> projects)
    {
        _projects = projects.Take(10).ToList();
        _progress = 0;
        _animation.Start();
    }

    private void OnPointerMoved(object? sender, PointerEventArgs args)
    {
        if (_projects.Count == 0) return;
        SetHovered(Math.Clamp((int)(args.GetPosition(this).X / Math.Max(1, Bounds.Width / _projects.Count)), 0, _projects.Count - 1));
    }

    private void OnKeyDown(object? sender, KeyEventArgs args)
    {
        if (_projects.Count == 0) return;
        var next = args.Key switch
        {
            Key.Left or Key.Up => Math.Max(0, (_hovered < 0 ? 0 : _hovered) - 1),
            Key.Right or Key.Down => Math.Min(_projects.Count - 1, Math.Max(0, _hovered) + 1),
            Key.Home => 0,
            Key.End => _projects.Count - 1,
            _ => -1,
        };
        if (next < 0) return;
        args.Handled = true;
        SetHovered(next);
    }

    private void SetHovered(int index)
    {
        if (_projects.Count == 0) return;
        _hovered = Math.Clamp(index, 0, _projects.Count - 1);
        var project = _projects[_hovered];
        ChartAccessibility.Describe(this, $"{project.Name}\n{project.Sessions:N0} sessions\n{project.Messages:N0} messages\n{TimeSpan.FromSeconds(project.DurationSec):d\\.hh\\:mm} active duration");
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_projects.Count == 0) return;
        var width = Bounds.Width;
        var height = Bounds.Height;
        var slot = width / _projects.Count;
        var messageMax = Math.Max(1, _projects.Max(project => project.Messages));
        var durationMax = Math.Max(1L, _projects.Max(project => project.DurationSec));
        var sessionMax = Math.Max(1, _projects.Max(project => project.Sessions));
        Point? previous = null;
        var visibleBars = (ShowMessages ? 1 : 0) + (ShowDuration ? 1 : 0);
        for (var index = 0; index < _projects.Count; index++)
        {
            if (index == _hovered)
                context.DrawRectangle(new SolidColorBrush(Color.FromArgb(24, 255, 255, 255)), null, new Rect(index * slot, 0, slot, height));
            var project = _projects[index];
            var barWidth = visibleBars == 0 ? 0 : Math.Max(3, Math.Min(slot * .28, (slot * .62 - Math.Max(0, visibleBars - 1) * 2) / visibleBars));
            var barsWidth = visibleBars * barWidth + Math.Max(0, visibleBars - 1) * 2;
            var x = index * slot + (slot - barsWidth) / 2;
            var messageHeight = (height - 12) * project.Messages / messageMax * _progress;
            var durationHeight = (height - 12) * project.DurationSec / durationMax * _progress;
            if (ShowMessages)
            {
                context.DrawRectangle(MessagesBrush, null, new Rect(x, height - messageHeight, barWidth, messageHeight));
                x += barWidth + 2;
            }
            if (ShowDuration)
                context.DrawRectangle(DurationBrush, null, new Rect(x, height - durationHeight, barWidth, durationHeight));
            if (ShowSessions)
            {
                var point = new Point(index * slot + slot / 2, height - (height - 12) * project.Sessions / sessionMax * _progress);
                if (previous is Point start) context.DrawLine(new Pen(SessionsBrush, 2), start, point);
                context.DrawEllipse(SessionsBrush, null, point, 3.5, 3.5);
                previous = point;
            }
        }
        ChartAccessibility.DrawFocus(context, this);
    }
}

public sealed class ContextDonutControl : AccessibleChartControl
{
    private string[] _labels = [];
    private long[] _values = [];
    private int _hovered = -1;
    public IReadOnlyList<IBrush> SegmentBrushes { get; set; } =
    [
        Brush.Parse("#38BDF8"), Brush.Parse("#8B5CF6"), Brush.Parse("#00FFA3"),
        Brush.Parse("#F59E0B"), Brush.Parse("#EF4444"), Brush.Parse("#334155")
    ];

    public ContextDonutControl()
    {
        MinWidth = 90;
        MinHeight = 90;
        Focusable = true;
        AutomationProperties.SetName(this, "Context window composition");
        AutomationProperties.SetHelpText(this, "Use Left and Right arrow keys to inspect context categories.");
        PointerMoved += OnPointerMoved;
        PointerExited += (_, _) => { if (!IsFocused) { _hovered = -1; ToolTip.SetTip(this, null); InvalidateVisual(); } };
        GotFocus += (_, _) => SetHovered(_hovered >= 0 ? _hovered : 0);
        LostFocus += (_, _) => { _hovered = -1; ToolTip.SetTip(this, null); InvalidateVisual(); };
        KeyDown += OnKeyDown;
    }

    public void SetData(IEnumerable<(string Label, long Value)> segments)
    {
        var values = segments.Where(segment => segment.Value > 0).ToList();
        _labels = values.Select(segment => segment.Label).ToArray();
        _values = values.Select(segment => segment.Value).ToArray();
        InvalidateVisual();
    }

    private void OnPointerMoved(object? sender, PointerEventArgs args)
    {
        var total = _values.Sum();
        if (total <= 0) return;
        var point = args.GetPosition(this);
        var center = new Point(Bounds.Width / 2, Bounds.Height / 2);
        var distance = Math.Sqrt(Math.Pow(point.X - center.X, 2) + Math.Pow(point.Y - center.Y, 2));
        var radius = Math.Min(Bounds.Width, Bounds.Height) / 2 - 5;
        if (distance < radius * .48 || distance > radius * 1.18)
        {
            if (!IsFocused)
            {
                _hovered = -1;
                ToolTip.SetTip(this, null);
            }
            InvalidateVisual();
            return;
        }
        var angle = (Math.Atan2(point.Y - center.Y, point.X - center.X) * 180 / Math.PI + 450) % 360;
        var target = angle / 360 * total;
        long sum = 0;
        for (var index = 0; index < _values.Length; index++)
        {
            sum += _values[index];
            if (target <= sum) { _hovered = index; break; }
        }
        SetHovered(_hovered);
    }

    private void OnKeyDown(object? sender, KeyEventArgs args)
    {
        if (_values.Length == 0) return;
        var next = args.Key switch
        {
            Key.Left or Key.Up => Math.Max(0, (_hovered < 0 ? 0 : _hovered) - 1),
            Key.Right or Key.Down => Math.Min(_values.Length - 1, Math.Max(0, _hovered) + 1),
            Key.Home => 0,
            Key.End => _values.Length - 1,
            _ => -1,
        };
        if (next < 0) return;
        args.Handled = true;
        SetHovered(next);
    }

    private void SetHovered(int index)
    {
        var total = _values.Sum();
        if (total <= 0 || _values.Length == 0) return;
        _hovered = Math.Clamp(index, 0, _values.Length - 1);
        ChartAccessibility.Describe(this, $"{_labels[_hovered]}\n{ChartFormat.Number(_values[_hovered])} · {_values[_hovered] * 100d / total:0.#}%");
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var total = _values.Sum();
        if (total <= 0) return;
        var center = new Point(Bounds.Width / 2, Bounds.Height / 2);
        var radius = Math.Max(8, Math.Min(Bounds.Width, Bounds.Height) / 2 - 8);
        var startAngle = -90d;
        for (var index = 0; index < _values.Length; index++)
        {
            var sweep = Math.Min(359.9, 360d * _values[index] / total);
            var geometry = Arc(center, radius, startAngle, sweep);
            context.DrawGeometry(null, new Pen(SegmentBrushes[index % SegmentBrushes.Count], index == _hovered ? 13 : 10), geometry);
            startAngle += sweep;
        }
        ChartAccessibility.DrawFocus(context, this);
    }

    private static StreamGeometry Arc(Point center, double radius, double startAngle, double sweep)
    {
        static Point At(Point center, double radius, double angle)
        {
            var radians = angle * Math.PI / 180;
            return new Point(center.X + radius * Math.Cos(radians), center.Y + radius * Math.Sin(radians));
        }
        var geometry = new StreamGeometry();
        using var path = geometry.Open();
        path.BeginFigure(At(center, radius, startAngle), false);
        path.ArcTo(At(center, radius, startAngle + sweep), new Size(radius, radius), 0, sweep > 180, SweepDirection.Clockwise);
        return geometry;
    }
}
