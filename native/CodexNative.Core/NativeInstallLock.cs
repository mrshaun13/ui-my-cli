using System.Diagnostics;

namespace CodexNative.Core;

public sealed class NativeInstallLock : IDisposable
{
    public const string AuthorizedRestartArgument = "--wait-for-update-lock";
    private readonly FileStream _stream;

    private NativeInstallLock(FileStream stream) => _stream = stream;

    public static NativeInstallLock Acquire(string installDirectory, TimeSpan timeout)
    {
        var path = LockPath(installDirectory);
        var elapsed = Stopwatch.StartNew();
        while (true)
        {
            try
            {
                return new NativeInstallLock(new FileStream(
                    path,
                    FileMode.OpenOrCreate,
                    FileAccess.ReadWrite,
                    FileShare.None,
                    bufferSize: 1,
                    options: FileOptions.WriteThrough));
            }
            catch (IOException) when (elapsed.Elapsed < timeout)
            {
                Thread.Sleep(TimeSpan.FromMilliseconds(100));
            }
            catch (UnauthorizedAccessException) when (elapsed.Elapsed < timeout)
            {
                Thread.Sleep(TimeSpan.FromMilliseconds(100));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                throw new TimeoutException(
                    $"The Codex Native installation is locked by another update; retry after it finishes ({path}).",
                    ex);
            }
        }
    }

    public static bool IsHeld(string installDirectory)
    {
        try
        {
            using var held = Acquire(installDirectory, TimeSpan.Zero);
            return false;
        }
        catch (TimeoutException)
        {
            return true;
        }
    }

    public static bool CanStart(bool lockHeld, IReadOnlyList<string> arguments) =>
        !lockHeld || arguments.Contains(AuthorizedRestartArgument, StringComparer.Ordinal);

    public static string LockPath(string installDirectory)
    {
        if (!Path.IsPathFullyQualified(installDirectory) || installDirectory.Any(char.IsControl))
            throw new ArgumentException("Install directory must be absolute.", nameof(installDirectory));
        var target = Path.GetFullPath(installDirectory)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var parent = Directory.GetParent(target)?.FullName
            ?? throw new ArgumentException("Install directory must have a parent.", nameof(installDirectory));
        var name = Path.GetFileName(target);
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Install directory name is invalid.", nameof(installDirectory));
        return Path.Combine(parent, $".{name}.update.lock");
    }

    public void Dispose() => _stream.Dispose();
}
