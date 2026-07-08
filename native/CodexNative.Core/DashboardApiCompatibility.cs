namespace CodexNative.Core;

public static class DashboardApiCompatibility
{
    public const int RequiredVersion = 2;

    public static bool IsCompatible(int reportedVersion) => reportedVersion == RequiredVersion;
}
