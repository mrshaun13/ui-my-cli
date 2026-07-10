namespace CodexNative.Core;

public readonly record struct TerminalCell(int Column, int Row);

public static class TerminalSelectionGeometry
{
    public static TerminalCell CellAt(
        double x,
        double y,
        double width,
        double height,
        int columns,
        int rows)
    {
        if (width <= 0) throw new ArgumentOutOfRangeException(nameof(width));
        if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height));
        if (columns <= 0) throw new ArgumentOutOfRangeException(nameof(columns));
        if (rows <= 0) throw new ArgumentOutOfRangeException(nameof(rows));

        var column = Math.Clamp((int)(x / (width / columns)), 0, columns - 1);
        var row = Math.Clamp((int)(y / (height / rows)), 0, rows - 1);
        return new TerminalCell(column, row);
    }
}
