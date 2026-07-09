namespace CodexNative.Core;

public static class NativeUpdateDataServiceRecovery
{
    public static async Task<T> RunAsync<T>(
        Func<CancellationToken, Task<T>> operation,
        Func<CancellationToken, Task<bool>> recover,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ArgumentNullException.ThrowIfNull(recover);

        try
        {
            return await operation(cancellationToken);
        }
        catch (Exception ex) when (IsUnavailable(ex, cancellationToken))
        {
            if (!await recover(cancellationToken))
            {
                throw new InvalidOperationException(
                    "The dashboard data service stopped before the update handoff and could not be restarted.",
                    ex);
            }
        }

        return await operation(cancellationToken);
    }

    private static bool IsUnavailable(Exception exception, CancellationToken cancellationToken) =>
        exception is HttpRequestException
        || exception is OperationCanceledException && !cancellationToken.IsCancellationRequested;
}
