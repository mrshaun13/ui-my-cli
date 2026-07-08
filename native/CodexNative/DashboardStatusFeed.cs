using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace CodexNative;

/// <summary>
/// Reconnecting client for the dashboard's Codex status feed. The server pushes
/// file-system changes immediately and also emits a three-second heartbeat.
/// </summary>
public sealed class DashboardStatusFeed : IAsyncDisposable
{
    private readonly Uri _endpoint;
    private readonly CancellationTokenSource _lifetime = new();
    private Task? _runTask;

    public event Action<IReadOnlyList<DashboardSession>>? SessionsReceived;
    public event Action<string, string>? SessionRekeyed;
    public event Action<string>? PendingSessionExpired;
    public event Action<bool>? ConnectionChanged;

    public DashboardStatusFeed(Uri endpoint) => _endpoint = endpoint;

    public void Start() => _runTask ??= RunAsync(_lifetime.Token);

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var attempt = 0;
        while (!cancellationToken.IsCancellationRequested)
        {
            using var socket = new ClientWebSocket();
            try
            {
                await socket.ConnectAsync(_endpoint, cancellationToken);
                attempt = 0;
                ConnectionChanged?.Invoke(true);
                await ReceiveAsync(socket, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                NativeLog.Write($"Status feed reconnecting after error: {ex.Message}");
            }
            finally
            {
                ConnectionChanged?.Invoke(false);
            }

            attempt++;
            var delay = TimeSpan.FromSeconds(Math.Min(15, Math.Pow(2, Math.Min(attempt, 4))));
            try { await Task.Delay(delay, cancellationToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task ReceiveAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) return;
            message.Write(buffer, 0, result.Count);
            if (!result.EndOfMessage) continue;

            if (result.MessageType == WebSocketMessageType.Text)
            {
                HandleMessage(Encoding.UTF8.GetString(message.GetBuffer(), 0, checked((int)message.Length)));
            }
            message.SetLength(0);
        }
    }

    private void HandleMessage(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            var type = root.GetProperty("type").GetString();
            switch (type)
            {
                case "sessions":
                    var sessions = root.GetProperty("data").Deserialize<List<DashboardSession>>(new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true,
                    });
                    if (sessions is not null) SessionsReceived?.Invoke(sessions);
                    break;
                case "rekey":
                    SessionRekeyed?.Invoke(
                        root.GetProperty("tempKey").GetString() ?? string.Empty,
                        root.GetProperty("realId").GetString() ?? string.Empty);
                    break;
                case "pending-expired":
                    PendingSessionExpired?.Invoke(root.GetProperty("tempKey").GetString() ?? string.Empty);
                    break;
            }
        }
        catch (Exception ex)
        {
            NativeLog.Write($"Ignoring malformed status message: {ex.Message}");
        }
    }

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        if (_runTask is not null)
        {
            try { await _runTask; }
            catch (OperationCanceledException) { }
        }
        _lifetime.Dispose();
    }
}
