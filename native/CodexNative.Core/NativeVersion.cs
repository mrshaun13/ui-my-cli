namespace CodexNative.Core;

public readonly record struct NativeVersion(int Major, int Minor, int Patch) : IComparable<NativeVersion>
{
    public static NativeVersion Parse(string value)
    {
        if (!TryParse(value, out var version))
            throw new FormatException($"'{value}' is not a supported semantic version.");
        return version;
    }

    public static bool TryParse(string? value, out NativeVersion version)
    {
        version = default;
        if (string.IsNullOrWhiteSpace(value)) return false;
        var normalized = value.Trim();
        if (normalized.StartsWith('v')) normalized = normalized[1..];
        var components = normalized.Split('.');
        if (components.Length != 3
            || !int.TryParse(components[0], out var major)
            || !int.TryParse(components[1], out var minor)
            || !int.TryParse(components[2], out var patch)
            || major < 0 || minor < 0 || patch < 0)
            return false;
        version = new NativeVersion(major, minor, patch);
        return true;
    }

    public int CompareTo(NativeVersion other)
    {
        var major = Major.CompareTo(other.Major);
        if (major != 0) return major;
        var minor = Minor.CompareTo(other.Minor);
        return minor != 0 ? minor : Patch.CompareTo(other.Patch);
    }

    public override string ToString() => $"{Major}.{Minor}.{Patch}";

    public static bool operator >(NativeVersion left, NativeVersion right) => left.CompareTo(right) > 0;
    public static bool operator <(NativeVersion left, NativeVersion right) => left.CompareTo(right) < 0;
    public static bool operator >=(NativeVersion left, NativeVersion right) => left.CompareTo(right) >= 0;
    public static bool operator <=(NativeVersion left, NativeVersion right) => left.CompareTo(right) <= 0;
}
