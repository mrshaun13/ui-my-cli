namespace CodexNative.Core;

public static class DashboardServicePorts
{
    public const int Shared = 7575;
    public const int FirstPrivate = 7577;
    public const int LastPrivate = 7596;

    public static IReadOnlyList<int> PrivateCandidates { get; } =
        Enumerable.Range(FirstPrivate, LastPrivate - FirstPrivate + 1).ToArray();

    public static bool IsPrivateCandidate(int port) =>
        port >= FirstPrivate && port <= LastPrivate;
}
