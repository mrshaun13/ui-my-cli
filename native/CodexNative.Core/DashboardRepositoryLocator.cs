namespace CodexNative.Core;

public static class DashboardRepositoryLocator
{
    public static string Find(
        string applicationDirectory,
        string homeDirectory,
        string? configuredDirectory = null,
        Func<string, bool>? fileExists = null)
    {
        fileExists ??= File.Exists;
        var candidates = new List<string>();
        if (IsAbsoluteSafePath(configuredDirectory)) candidates.Add(configuredDirectory!);

        if (IsAbsoluteSafePath(applicationDirectory))
        {
            var current = new DirectoryInfo(applicationDirectory);
            for (var depth = 0; current is not null && depth < 10; depth++, current = current.Parent)
                candidates.Add(current.FullName);
        }

        candidates.Add(Path.Combine(homeDirectory, "ui-my-cli"));
        candidates.Add(Path.Combine(homeDirectory, "personal", "ui-my-cli"));
        candidates.Add(Path.Combine(homeDirectory, "git", "ui-my-cli"));

        var match = candidates
            .Where(IsAbsoluteSafePath)
            .Distinct(StringComparer.Ordinal)
            .FirstOrDefault(path =>
                fileExists(Path.Combine(path, "package.json"))
                && fileExists(Path.Combine(path, "server", "index.js")));
        if (match is not null) return match;
        if (IsAbsoluteSafePath(configuredDirectory)) return configuredDirectory!;
        return Path.Combine(homeDirectory, "ui-my-cli");
    }

    private static bool IsAbsoluteSafePath(string? path) =>
        !string.IsNullOrWhiteSpace(path)
        && Path.IsPathFullyQualified(path)
        && !path.Any(char.IsControl);
}
