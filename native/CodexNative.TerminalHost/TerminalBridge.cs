using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace CodexNative.TerminalHost;

/// <summary>
/// Bridges the native Avalonia PTY to ui-my-cli's persistent server PTY.
/// The bridge may exit with the desktop UI while the Codex process and its
/// scrollback remain owned by the dashboard service for later reattachment.
/// </summary>
internal static class TerminalBridge
{
    private static readonly SemaphoreSlim SendLock = new(1, 1);
    private static ClientWebSocket? _socket;

    public static async Task<int> RunAsync(Uri endpoint)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;
        using var consoleInputMode = WindowsConsoleInputMode.Enter();
        using var lifetime = new CancellationTokenSource();
        using var socket = new ClientWebSocket();
        _socket = socket;

        Console.CancelKeyPress += OnCancelKeyPress;
        try
        {
            await socket.ConnectAsync(endpoint, lifetime.Token);
            var input = PumpInputAsync(socket, lifetime.Token);
            var resize = PumpResizeAsync(socket, lifetime.Token);
            var exitCode = await PumpOutputAsync(socket, lifetime.Token);
            lifetime.Cancel();
            await IgnoreCancellation(input);
            await IgnoreCancellation(resize);
            return exitCode;
        }
        catch (WebSocketException ex)
        {
            Console.Error.WriteLine($"\r\n[terminal connection failed: {ex.Message}]");
            return 2;
        }
        finally
        {
            Console.CancelKeyPress -= OnCancelKeyPress;
            _socket = null;
        }
    }

    private static async Task PumpInputAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var input = Console.OpenStandardInput();
        var buffer = new byte[4096];
        while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            var count = await input.ReadAsync(buffer, cancellationToken);
            if (count == 0) break;
            await SendAsync(socket, new { type = "input", data = Encoding.UTF8.GetString(buffer, 0, count) }, cancellationToken);
        }
    }

    private static async Task<int> PumpOutputAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) return 0;
            message.Write(buffer, 0, result.Count);
            if (!result.EndOfMessage) continue;

            var raw = Encoding.UTF8.GetString(message.GetBuffer(), 0, checked((int)message.Length));
            message.SetLength(0);
            try
            {
                using var json = JsonDocument.Parse(raw);
                var root = json.RootElement;
                switch (root.GetProperty("type").GetString())
                {
                    case "output":
                        Console.Write(root.GetProperty("data").GetString());
                        break;
                    case "exit":
                        return root.TryGetProperty("exitCode", out var code) ? code.GetInt32() : 0;
                }
            }
            catch (JsonException)
            {
                Console.Write(raw);
            }
        }
        return 0;
    }

    private static async Task PumpResizeAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var lastColumns = 0;
        var lastRows = 0;
        while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            int columns;
            int rows;
            try
            {
                columns = Math.Max(1, Console.WindowWidth);
                rows = Math.Max(1, Console.WindowHeight);
            }
            catch
            {
                columns = 120;
                rows = 36;
            }
            if (columns != lastColumns || rows != lastRows)
            {
                await SendAsync(socket, new { type = "resize", cols = columns, rows }, cancellationToken);
                lastColumns = columns;
                lastRows = rows;
            }
            await Task.Delay(500, cancellationToken);
        }
    }

    private static async Task SendAsync(ClientWebSocket socket, object payload, CancellationToken cancellationToken)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
        await SendLock.WaitAsync(cancellationToken);
        try
        {
            if (socket.State == WebSocketState.Open)
                await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
        }
        finally
        {
            SendLock.Release();
        }
    }

    private static void OnCancelKeyPress(object? sender, ConsoleCancelEventArgs args)
    {
        args.Cancel = true;
        var socket = _socket;
        if (socket?.State != WebSocketState.Open) return;
        try { SendAsync(socket, new { type = "input", data = "\u0003" }, CancellationToken.None).GetAwaiter().GetResult(); }
        catch { }
    }

    private static async Task IgnoreCancellation(Task task)
    {
        try { await task; }
        catch (OperationCanceledException) { }
    }
}
