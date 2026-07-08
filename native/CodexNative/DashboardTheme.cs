using Avalonia.Media;

namespace CodexNative;

public sealed record DashboardTheme(
    string Id,
    string Label,
    string Base,
    string Surface,
    string Elevated,
    string Hover,
    string Border,
    string BorderBright,
    string Primary,
    string Secondary,
    string Muted,
    string Accent,
    string Terminal,
    bool IsLight = false)
{
    public static IReadOnlyList<DashboardTheme> All { get; } =
    [
        new("signal", "Signal", "#080C10", "#0D1117", "#131A22", "#1A2535", "#1E2D3D", "#2A3F56", "#E2E8F0", "#7A94AE", "#3D5470", "#00FFA3", "#071015"),
        new("carbon", "Carbon", "#090A0C", "#101215", "#181B20", "#22272E", "#2A2F36", "#414953", "#F3F4F6", "#A1A8B3", "#606975", "#38BDF8", "#121417"),
        new("midnight", "Midnight", "#070B18", "#0C1224", "#121B32", "#1A2743", "#213150", "#344B73", "#EEF4FF", "#91A6C9", "#506584", "#7DD3FC", "#0A1024"),
        new("forest", "Forest", "#07100B", "#0C1710", "#132119", "#1A2E22", "#203528", "#355642", "#EDF7EE", "#92AE98", "#526F59", "#A3E635", "#0B1710"),
        new("solarized-dark", "Solarized Dark", "#00232B", "#002B36", "#073642", "#104653", "#164D59", "#2B6570", "#FDF6E3", "#93A1A1", "#586E75", "#2AA198", "#002B36"),
        new("plum", "Plum", "#100B12", "#18111B", "#231927", "#302136", "#38263E", "#56365F", "#F8F1F8", "#B69EB8", "#745B78", "#F0ABFC", "#160D19"),
        new("ember", "Ember", "#100C09", "#18120E", "#241A13", "#322319", "#3A291D", "#5B3C29", "#FFF5ED", "#B9A08F", "#765F50", "#FB923C", "#17100B"),
        new("cyan-grid", "Cyan Grid", "#051014", "#08191F", "#0D242C", "#12313A", "#17434E", "#246473", "#A5F3FC", "#67C6D3", "#3C7F89", "#22D3EE", "#031216"),
        new("amber-crt", "Amber CRT", "#120C03", "#1A1105", "#251A09", "#33240D", "#493315", "#6B4A1C", "#FDE68A", "#D5A84E", "#80652F", "#F59E0B", "#100A02"),
        new("rose-noir", "Rose Noir", "#14070C", "#1E0C13", "#2A111B", "#391824", "#502131", "#743047", "#FECDD3", "#D98B9B", "#8A5360", "#FB7185", "#12060A"),
        new("ultraviolet", "Ultraviolet", "#0D0716", "#150C22", "#211333", "#2D1B43", "#40275A", "#624083", "#DDD6FE", "#AC9BDD", "#695C8C", "#A78BFA", "#0A0512"),
        new("cobalt", "Cobalt", "#050B18", "#091329", "#0E1D3B", "#15294F", "#1D3A68", "#2B5793", "#BFDBFE", "#7BAAE1", "#486D9A", "#3B82F6", "#040A16"),
        new("neon-red", "Neon Red", "#050000", "#0A0202", "#120505", "#1E0808", "#2C0B0B", "#5A1515", "#FF6B6B", "#E24B4B", "#8A2E2E", "#FF2D2D", "#000000"),
        new("neon-blue", "Neon Blue", "#000205", "#02060C", "#050C17", "#081426", "#0B1D38", "#153B70", "#70A7FF", "#4D83E6", "#2D518F", "#2979FF", "#000000"),
        new("neon-green", "Neon Green", "#000500", "#020A03", "#051207", "#081E0C", "#0B2C12", "#155A27", "#69F58B", "#43D46A", "#2B823F", "#22E05B", "#000000"),
        new("neon-purple", "Neon Purple", "#030005", "#07020B", "#100516", "#1A0825", "#260C36", "#4E196F", "#C493FF", "#9B68DB", "#60418A", "#A855F7", "#000000"),
        new("paper", "Paper", "#EEF1F5", "#FFFFFF", "#F5F7FA", "#E8EDF3", "#D5DCE5", "#B7C2CF", "#172033", "#526078", "#8894A5", "#2563EB", "#F7F9FC", true),
        new("arctic", "Arctic", "#E7F0F5", "#F8FCFE", "#EDF6FA", "#DCECF3", "#C5DCE6", "#9FC2D1", "#102A36", "#426675", "#7695A1", "#0891B2", "#EDF7FA", true),
        new("solarized-light", "Solarized Light", "#EEE8D5", "#FDF6E3", "#F5EFDC", "#E6DFCA", "#D3CBB6", "#B9AD92", "#073642", "#586E75", "#93A1A1", "#268BD2", "#F8F1DE", true),
    ];

    public static DashboardTheme Find(string? id) =>
        All.FirstOrDefault(theme => theme.Id == id) ?? All[0];

    public IBrush Brush(string color) => Avalonia.Media.Brush.Parse(color);
}

public sealed record DashboardTextSize(string Id, string Label, double Scale, double TerminalFontSize)
{
    public static IReadOnlyList<DashboardTextSize> All { get; } =
    [
        new("standard", "Standard", 1, 13),
        new("large", "Large", 1.15, 15),
        new("xl", "XL", 1.31, 17),
        new("xxl", "XXL", 1.46, 19),
    ];

    public static DashboardTextSize Find(string? id) =>
        All.FirstOrDefault(size => size.Id == id) ?? All[0];
}
