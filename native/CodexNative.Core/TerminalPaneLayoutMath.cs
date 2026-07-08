namespace CodexNative.Core;

public static class TerminalPaneLayoutMath
{
    public static double EqualPaneWidth(double viewportWidth, int paneCount, double minimumWidth, double splitterWidth)
    {
        if (paneCount <= 0) return 0;
        var splitters = Math.Max(0, paneCount - 1) * Math.Max(0, splitterWidth);
        var available = Math.Max(minimumWidth * paneCount, Math.Max(0, viewportWidth) - splitters);
        return Math.Max(minimumWidth, available / paneCount);
    }

    public static double TotalWidth(IEnumerable<double> paneWidths, double splitterWidth)
    {
        var widths = paneWidths.ToList();
        return widths.Sum(width => Math.Max(0, width))
            + Math.Max(0, widths.Count - 1) * Math.Max(0, splitterWidth);
    }
}
