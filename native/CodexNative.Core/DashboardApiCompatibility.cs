namespace CodexNative.Core;

public static class DashboardApiCompatibility
{
    public const int RequiredVersion = 1;

    public static bool IsCompatible(int reportedVersion)
    {
        var normalized = reportedVersion == 0 ? 1 : reportedVersion;
        return normalized == RequiredVersion;
    }
}
