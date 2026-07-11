using System.Security.Cryptography;

namespace CodexNative.Core;

public sealed record DashboardServiceOwnership(
    int ProcessId,
    long ProcessStartTimeUnixMilliseconds,
    int Port,
    string InstanceId,
    string ControlCapability)
{
    public const string ControlCapabilityEnvironmentVariable = "UI_MY_CLI_NATIVE_CONTROL_CAPABILITY";
    public const string ControlCapabilityHeader = "X-UI-My-CLI-Control";

    public static string CreateControlCapability() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    public bool IsStructurallyValid() =>
        ProcessId > 0
        && ProcessStartTimeUnixMilliseconds > 0
        && DashboardServicePorts.IsPrivateCandidate(Port)
        && Guid.TryParseExact(InstanceId, "D", out _)
        && IsValidControlCapability(ControlCapability);

    public static bool IsValidControlCapability(string? value) =>
        value is { Length: 64 }
        && value.All(character => character is >= '0' and <= '9' or >= 'A' and <= 'F');
}
