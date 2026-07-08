namespace CodexNative.Core;

public static class TokenChartMath
{
    public static double CommonMaximum(
        IEnumerable<double> input,
        IEnumerable<double> output) => Math.Max(
            1,
            Math.Max(input.DefaultIfEmpty().Max(), output.DefaultIfEmpty().Max()));
}
