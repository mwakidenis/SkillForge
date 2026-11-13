namespace SkillForgeTray.Models;

/// <summary>
/// Strongly-typed DTOs matching @skillforge/core IPC payloads.
/// </summary>
public record DaemonStatusDto(
    string Status,
    string? ActiveRunId,
    string? ActiveSkillId,
    long UptimeMs,
    string? LatestCheckpointId,
    string? Timestamp,
    HarnessEventDto[] RecentEvents
);

public record HarnessEventDto(
    string Type,
    string Timestamp,
    string RunId,
    string? SkillId,
    int? StepIndex,
    Dictionary<string, object?> Payload
);

public record RollbackResponseDto(
    bool Ok,
    string? RunId,
    bool Restored,
    bool WorkingTreeMatches,
    string? Message
);
