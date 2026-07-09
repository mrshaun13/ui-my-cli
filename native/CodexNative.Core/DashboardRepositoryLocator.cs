namespace CodexNative.Core;

public sealed record DashboardRepositoryReadiness(
    string Directory,
    bool HasCheckout,
    bool HasNodeDependencies)
{
    public bool IsReady => HasCheckout && HasNodeDependencies;

    public string DescribeFailure() => !HasCheckout
        ? $"No ui-my-cli checkout was found at {Directory}."
        : $"The ui-my-cli checkout at {Directory} is missing Node dependencies. Run npm install in that checkout.";
}

public static class DashboardRepositoryLocator
{
    public static string Find(
        string applicationDirectory,
        string homeDirectory,
        string? configuredDirectory = null,
        Func<string, bool>? fileExists = null,
        Func<string, IEnumerable<string>>? enumerateDirectories = null)
    {
        fileExists ??= File.Exists;
        enumerateDirectories ??= Directory.EnumerateDirectories;
        var candidates = Candidates(
            applicationDirectory,
            homeDirectory,
            configuredDirectory,
            enumerateDirectories);

        var ready = candidates.FirstOrDefault(path => Inspect(path, fileExists).IsReady);
        if (ready is not null) return ready;

        var checkout = candidates.FirstOrDefault(path => Inspect(path, fileExists).HasCheckout);
        if (checkout is not null) return checkout;
        if (IsAbsoluteSafePath(configuredDirectory)) return configuredDirectory!;
        return Path.Combine(homeDirectory, "ui-my-cli");
    }

    public static DashboardRepositoryReadiness Inspect(
        string directory,
        Func<string, bool>? fileExists = null)
    {
        fileExists ??= File.Exists;
        if (!IsAbsoluteSafePath(directory)) return new DashboardRepositoryReadiness(directory, false, false);
        var checkout = fileExists(Path.Combine(directory, "package.json"))
            && fileExists(Path.Combine(directory, "server", "index.js"));
        var dependencies = checkout
            && fileExists(Path.Combine(directory, "node_modules", "express", "package.json"))
            && fileExists(Path.Combine(directory, "node_modules", "node-pty", "package.json"));
        return new DashboardRepositoryReadiness(directory, checkout, dependencies);
    }

    private static IReadOnlyList<string> Candidates(
        string applicationDirectory,
        string homeDirectory,
        string? configuredDirectory,
        Func<string, IEnumerable<string>> enumerateDirectories)
    {
        var candidates = new List<string>();
        if (IsAbsoluteSafePath(configuredDirectory)) candidates.Add(configuredDirectory!);

        if (IsAbsoluteSafePath(applicationDirectory))
        {
            var current = new DirectoryInfo(applicationDirectory);
            for (var depth = 0; current is not null && depth < 10; depth++, current = current.Parent)
                candidates.Add(current.FullName);
        }

        foreach (var relativeRoot in new[] { "", "personal", "git", "Desktop", "Documents", "Developer", "Projects", "Code" })
        {
            var root = string.IsNullOrEmpty(relativeRoot) ? homeDirectory : Path.Combine(homeDirectory, relativeRoot);
            candidates.Add(Path.Combine(root, "ui-my-cli"));
            try
            {
                candidates.AddRange(enumerateDirectories(root)
                    .Select(directory => Path.Combine(directory, "ui-my-cli")));
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        return candidates
            .Where(IsAbsoluteSafePath)
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    private static bool IsAbsoluteSafePath(string? path) =>
        !string.IsNullOrWhiteSpace(path)
        && Path.IsPathFullyQualified(path)
        && !path.Any(char.IsControl);
}
