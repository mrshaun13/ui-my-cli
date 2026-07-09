namespace CodexNative.Core;

public static class TerminalPaneLayoutMath
{
    public static (double Left, double Right) ResizePair(
        double leftWidth,
        double rightWidth,
        double requestedChange,
        double minimumWidth)
    {
        var minimum = Math.Max(0, minimumWidth);
        var total = Math.Max(minimum * 2, Math.Max(0, leftWidth) + Math.Max(0, rightWidth));
        var left = Math.Clamp(Math.Max(0, leftWidth) + requestedChange, minimum, total - minimum);
        return (left, total - left);
    }

    public static double EqualPaneWidth(double viewportWidth, int paneCount, double minimumWidth, double splitterWidth)
    {
        if (paneCount <= 0) return 0;
        var splitters = Math.Max(0, paneCount - 1) * Math.Max(0, splitterWidth);
        var available = Math.Max(minimumWidth * paneCount, Math.Max(0, viewportWidth) - splitters);
        return Math.Max(minimumWidth, available / paneCount);
    }

    public static IReadOnlyList<double> FitPaneWidths(
        IEnumerable<double> paneWidths,
        double viewportWidth,
        double minimumWidth,
        double splitterWidth)
    {
        var source = paneWidths.Select(width => Math.Max(0, width)).ToList();
        if (source.Count == 0) return [];

        var minimum = Math.Max(0, minimumWidth);
        var splitters = Math.Max(0, source.Count - 1) * Math.Max(0, splitterWidth);
        var target = Math.Max(minimum * source.Count, Math.Max(0, viewportWidth) - splitters);
        var weights = source.Select(width => width > 0 ? width : minimum).ToArray();
        if (weights.Sum() <= 0)
            return [.. Enumerable.Repeat(target / source.Count, source.Count)];

        var result = new double[source.Count];
        var remaining = Enumerable.Range(0, source.Count).ToList();
        var remainingTarget = target;
        while (remaining.Count > 0)
        {
            var weightTotal = remaining.Sum(index => weights[index]);
            if (weightTotal <= 0)
            {
                var equalWidth = remainingTarget / remaining.Count;
                foreach (var index in remaining) result[index] = equalWidth;
                break;
            }

            var scale = remainingTarget / weightTotal;
            var constrained = remaining
                .Where(index => weights[index] * scale < minimum)
                .ToList();
            if (constrained.Count == 0)
            {
                foreach (var index in remaining) result[index] = weights[index] * scale;
                break;
            }

            foreach (var index in constrained)
            {
                result[index] = minimum;
                remainingTarget -= minimum;
                remaining.Remove(index);
            }
        }

        return result;
    }

    public static double TotalWidth(IEnumerable<double> paneWidths, double splitterWidth)
    {
        var widths = paneWidths.ToList();
        return widths.Sum(width => Math.Max(0, width))
            + Math.Max(0, widths.Count - 1) * Math.Max(0, splitterWidth);
    }
}
