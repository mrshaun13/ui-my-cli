using System.Text.Json.Serialization;

namespace CodexNative;

public class DashboardSession
{
    public string Id { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string Source { get; set; } = "cli";
    public string ThreadSource { get; set; } = "user";
    public string Title { get; set; } = "Untitled session";
    public string WorkingDir { get; set; } = string.Empty;
    public string Project { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string ReasoningEffort { get; set; } = string.Empty;
    public string PermissionMode { get; set; } = string.Empty;
    public string Status { get; set; } = "idle";
    public string Snippet { get; set; } = string.Empty;
    public string FirstUserPrompt { get; set; } = string.Empty;
    public string LastUserPrompt { get; set; } = string.Empty;
    public string LastActivityAgo { get; set; } = string.Empty;
    public bool HasSubagents { get; set; }
    public bool Archived { get; set; }
    public long LastActivityAt { get; set; }
    public long CreatedAt { get; set; }

    [JsonIgnore]
    public bool IsHeadless => Id.StartsWith("tp:", StringComparison.Ordinal)
        || ThreadSource.Equals("headless", StringComparison.OrdinalIgnoreCase)
        || Source.Contains("headless", StringComparison.OrdinalIgnoreCase)
        || Source.Contains("transcript", StringComparison.OrdinalIgnoreCase);

    [JsonIgnore]
    public string DisplayTitle => string.IsNullOrWhiteSpace(Title) ? "Untitled session" : Title;

    [JsonIgnore]
    public string DisplayMeta => $"{Project} · {LastActivityAgo}".Trim(' ', '·');

    [JsonIgnore]
    public string StatusGlyph => Status switch
    {
        "question" => "⚡",
        "active" => "●",
        "finished" => "◆",
        _ => "○",
    };

    public override string ToString() => DisplayTitle;
}

public sealed class DashboardRepo
{
    public string WorkingDir { get; set; } = string.Empty;
    public string Project { get; set; } = string.Empty;
    public override string ToString() => string.IsNullOrWhiteSpace(Project) ? WorkingDir : Project;
}

public sealed class DashboardStats
{
    public ActivityStats Activity { get; set; } = new();
    public List<ProjectStats> Projects { get; set; } = [];
    public ToolGroups Tools { get; set; } = new();
    public List<ModelStats> Models { get; set; } = [];
    public List<NamedEnvironmentItem> McpServers { get; set; } = [];
    public List<NamedEnvironmentItem> Skills { get; set; } = [];
    public List<NamedEnvironmentItem> Plugins { get; set; } = [];
    public int TotalSubagents { get; set; }
    public Dictionary<string, int> SessionsByDay { get; set; } = [];
    public Dictionary<string, TokenWindow> TokensByHour { get; set; } = [];
    public List<List<HeatmapCell>> TokenHeatmap { get; set; } = [];
    public List<SessionRanking> TopSessionsByDuration { get; set; } = [];
    public List<SessionRanking> TopSessionsByUserMsgs { get; set; } = [];
    public List<SessionRanking> TopSessionsByTokens { get; set; } = [];
    public Dictionary<string, UsageRollup> UsageRollups { get; set; } = [];
    public PricingMetadata Pricing { get; set; } = new();
    public string CodexVersion { get; set; } = string.Empty;
    public RateLimitInfo? RateLimits { get; set; }
    public StatsFilterInfo StatsFilters { get; set; } = new();
}

public sealed class StatsFilterInfo
{
    public string StatsMode { get; set; } = "combined";
    public int TranscriptHeadlessCount { get; set; }
}

public sealed class DashboardStatus
{
    public bool Ok { get; set; }
    public int ApiVersion { get; set; }
    public int ActivePtys { get; set; }
    public long Uptime { get; set; }
    public List<ProviderStatus> Providers { get; set; } = [];
}

public sealed class ProviderStatus
{
    public string Id { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Noun { get; set; } = string.Empty;
    public string DashboardTitle { get; set; } = string.Empty;
    public string Command { get; set; } = string.Empty;
    public string Accent { get; set; } = string.Empty;
    public bool Available { get; set; }
    public string? Version { get; set; }
    public string? Error { get; set; }

    [JsonIgnore]
    public string DisplayLabel => string.IsNullOrWhiteSpace(Label) ? Id : Label;

    public override string ToString() => Available ? DisplayLabel : $"{DisplayLabel} (unavailable)";
}

public sealed class AdaptiveRouteResult
{
    public string Model { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Effort { get; set; } = string.Empty;
    public string Level { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public string Reason { get; set; } = string.Empty;
    public bool ClassifierUsed { get; set; }
    public string? SessionId { get; set; }
    public string? TurnId { get; set; }
}

public sealed class TokenWindow
{
    public List<long> Input { get; set; } = [];
    public List<long> Output { get; set; } = [];
}

public sealed class UsageRollup
{
    public string Window { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public UsageTotals Totals { get; set; } = new();
    public List<UsageBreakdown> Models { get; set; } = [];
    public List<UsageBreakdown> Projects { get; set; } = [];
    public List<UsageBreakdown> Sessions { get; set; } = [];
}

public class UsageTotals
{
    public long InputTokens { get; set; }
    public long TotalInputTokens { get; set; }
    public long CachedInputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long VisibleOutputTokens { get; set; }
    public long ReasoningOutputTokens { get; set; }
    public long UnclassifiedTokens { get; set; }
    public long TotalTokens { get; set; }
    public long Calls { get; set; }
    public double EstimatedCredits { get; set; }
    public long PricedTokens { get; set; }
    public long UnpricedTokens { get; set; }
    public double PricingCoverage { get; set; }
}

public sealed class UsageBreakdown : UsageTotals
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Project { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string ReasoningEffort { get; set; } = string.Empty;
}

public sealed class PricingMetadata
{
    public string Source { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string Unit { get; set; } = "credits";
    public string ReasoningBilling { get; set; } = string.Empty;
    public string SpeedBilling { get; set; } = string.Empty;
}

public sealed class HeatmapCell
{
    public Dictionary<string, long> Windows { get; set; } = [];
}

public sealed class SessionRanking
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Project { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string ReasoningEffort { get; set; } = string.Empty;
    public long DurationSec { get; set; }
    public string DurationStr { get; set; } = string.Empty;
    public int UserMsgCount { get; set; }
    public long InputTokens { get; set; }
    public long CachedInputTokens { get; set; }
    public long VisibleOutputTokens { get; set; }
    public long ReasoningOutputTokens { get; set; }
    public long CacheWriteTokens { get; set; }
    public long UnclassifiedTokens { get; set; }
    public long TotalTokens { get; set; }
    public double EstimatedCredits { get; set; }
    public long PricedTokens { get; set; }
    public long UnpricedTokens { get; set; }
    public double PricingCoverage { get; set; }
    public long Calls { get; set; }
}

public sealed class ActivityStats
{
    public int H24 { get; set; }
    public int H48 { get; set; }
    public int H72 { get; set; }
    public int Older { get; set; }
    public int Total { get; set; }
}

public sealed class ProjectStats
{
    public string Name { get; set; } = string.Empty;
    public int Sessions { get; set; }
    public int Messages { get; set; }
    public long DurationSec { get; set; }
}

public sealed class ToolGroups
{
    public List<ToolStats> Interactive { get; set; } = [];
    public List<ToolStats> Headless { get; set; } = [];
}

public sealed class ToolStats
{
    public string Name { get; set; } = string.Empty;
    public long Calls { get; set; }
}

public sealed class ModelStats
{
    public string Model { get; set; } = string.Empty;
    public string ReasoningEffort { get; set; } = string.Empty;
    public long Calls { get; set; }
    public long TotalTokens { get; set; }
    public int Sessions { get; set; }
    public long InputTokens { get; set; }
    public long TotalInputTokens { get; set; }
    public long CachedInputTokens { get; set; }
    public long CacheReadTokens { get; set; }
    public long CacheWriteTokens { get; set; }
    public long OutputTokens { get; set; }
    public long VisibleOutputTokens { get; set; }
    public long ReasoningOutputTokens { get; set; }
    public long UnclassifiedTokens { get; set; }
}

public sealed class NamedEnvironmentItem
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Url { get; set; }
    public string? Type { get; set; }
    public string? Dir { get; set; }
}

public sealed class SessionContextData
{
    public ContextCategories Categories { get; set; } = new();
    public long TotalUsed { get; set; }
    public long MaxContext { get; set; }
    public long FreeTokens { get; set; }
    public int CompactionCount { get; set; }
    public string Model { get; set; } = string.Empty;
}

public sealed class ContextCategories
{
    public long SystemPrompt { get; set; }
    public long UserMessages { get; set; }
    public long AssistantMessages { get; set; }
    public long ToolCalls { get; set; }
    public long ToolResults { get; set; }
}

public sealed class SessionConfigData
{
    public List<SessionRule> Rules { get; set; } = [];
    public List<NamedEnvironmentItem> ActiveSkills { get; set; } = [];
    public List<SessionPermission> Permissions { get; set; } = [];
    public string Model { get; set; } = string.Empty;
    public string ReasoningEffort { get; set; } = string.Empty;
    public string PermissionMode { get; set; } = string.Empty;
}

public sealed class SessionRule
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
}

public sealed class SessionPermission
{
    public string Scope { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
}

public sealed class SubagentData
{
    public string Id { get; set; } = string.Empty;
    public string AgentId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Profile { get; set; } = string.Empty;
    public string Nickname { get; set; } = string.Empty;
    public string Task { get; set; } = string.Empty;
    public string ResultPreview { get; set; } = string.Empty;
    public long? StartedAt { get; set; }
    public long? CompletedAt { get; set; }
    public long? DurationSec { get; set; }
    public bool IsBackground { get; set; }
    public string Status { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public int Order { get; set; }
}

public sealed class SessionPreviewData : DashboardSession
{
    public string StartingModel { get; set; } = string.Empty;
    public string CurrentModel { get; set; } = string.Empty;
    public string BackendType { get; set; } = string.Empty;
    public string CreatedAtStr { get; set; } = string.Empty;
    public string DurationStr { get; set; } = string.Empty;
    public string ProjectDurationStr { get; set; } = string.Empty;
    public int TotalNodes { get; set; }
    public int UserMsgCount { get; set; }
    public int AssistantMsgCount { get; set; }
    public int ToolCallCount { get; set; }
    public int CompactionCount { get; set; }
    public int SubagentCount { get; set; }
    public long PeakContextTokens { get; set; }
    public long ModelContextWindow { get; set; }
    public long InputTokens { get; set; }
    public long TotalInputTokens { get; set; }
    public long CachedInputTokens { get; set; }
    public long CacheReadTokens { get; set; }
    public long CacheWriteTokens { get; set; }
    public long OutputTokens { get; set; }
    public long VisibleOutputTokens { get; set; }
    public long ReasoningOutputTokens { get; set; }
    public long UnclassifiedTokens { get; set; }
    public long TotalTokens { get; set; }
    public double EstimatedCredits { get; set; }
    public long PricedTokens { get; set; }
    public long UnpricedTokens { get; set; }
    public double PricingCoverage { get; set; }
    public int Calls { get; set; }
    public List<PreviewTool> TopTools { get; set; } = [];
    public List<ModelSwitch> ModelSwitches { get; set; } = [];
    public RateLimitInfo? RateLimits { get; set; }
    public string TokenTelemetrySource { get; set; } = string.Empty;
    public string GitBranch { get; set; } = string.Empty;
    public string GitSha { get; set; } = string.Empty;
}

public sealed class ModelSwitch
{
    public string FromModel { get; set; } = string.Empty;
    public string FromReasoningEffort { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string ReasoningEffort { get; set; } = string.Empty;
    public long? Timestamp { get; set; }
    public string TurnId { get; set; } = string.Empty;
}

public sealed class RateLimitInfo
{
    [JsonPropertyName("limit_id")]
    public string LimitId { get; set; } = string.Empty;
    [JsonPropertyName("limit_name")]
    public string? LimitName { get; set; }
    public RateLimitWindow? Primary { get; set; }
    public RateLimitWindow? Secondary { get; set; }
    public CreditStatus? Credits { get; set; }
    [JsonPropertyName("plan_type")]
    public string? PlanType { get; set; }
    [JsonPropertyName("rate_limit_reached_type")]
    public string? ReachedType { get; set; }
}

public sealed class RateLimitWindow
{
    [JsonPropertyName("used_percent")]
    public double UsedPercent { get; set; }
    [JsonPropertyName("window_minutes")]
    public int WindowMinutes { get; set; }
    [JsonPropertyName("resets_at")]
    public long ResetsAt { get; set; }
}

public sealed class CreditStatus
{
    [JsonPropertyName("has_credits")]
    public bool HasCredits { get; set; }
    public bool Unlimited { get; set; }
    public double? Balance { get; set; }
}

public sealed class PreviewTool
{
    public string Name { get; set; } = string.Empty;
    public int Count { get; set; }
}

public sealed class SessionConversationData
{
    public List<ConversationTurn> Turns { get; set; } = [];
    public int TotalTurns { get; set; }
    public bool HasMore { get; set; }
}

public sealed class ConversationTurn
{
    public string UserText { get; set; } = string.Empty;
    public string AssistantText { get; set; } = string.Empty;
    public long? CreatedAt { get; set; }
    public long? AssistantCreatedAt { get; set; }
}
