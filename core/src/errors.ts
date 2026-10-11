// Stable API/domain error codes — contract section 11.

export type ErrorCode =
  | 'INVALID_SCHEMA'
  | 'UNAUTHENTICATED'
  | 'WORLD_ACCESS_DENIED'
  | 'WORLD_LIMIT_REACHED'
  | 'NOT_FOUND'
  | 'WORLD_VERSION_CONFLICT'
  | 'IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'RULE_PRECONDITION_FAILED'
  | 'INVALID_CHOICE'
  | 'RATE_LIMITED'
  | 'WORLD_BUDGET_EXCEEDED'
  | 'NARRATIVE_UNAVAILABLE'
  | 'UNKNOWN_COMMAND_TYPE'
  | 'UNKNOWN_EVENT_TYPE'
  | 'INVALID_BLUEPRINT';

export class EngineError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export const err = {
  invalidSchema: (msg: string, details?: Record<string, unknown>) =>
    new EngineError('INVALID_SCHEMA', 400, msg, details),
  unauthenticated: (msg = 'Authentication required') => new EngineError('UNAUTHENTICATED', 401, msg),
  accessDenied: (msg = 'World access denied') => new EngineError('WORLD_ACCESS_DENIED', 403, msg),
  worldLimit: (msg = 'Active world limit reached') => new EngineError('WORLD_LIMIT_REACHED', 403, msg),
  notFound: (msg = 'Resource not found') => new EngineError('NOT_FOUND', 404, msg),
  versionConflict: (currentVersion: number) =>
    new EngineError('WORLD_VERSION_CONFLICT', 409, 'World version conflict', { currentVersion }),
  idempotencyMismatch: () =>
    new EngineError('IDEMPOTENCY_PAYLOAD_MISMATCH', 409, 'Command id reused with a different payload'),
  precondition: (ruleCode: string, msg: string) =>
    new EngineError('RULE_PRECONDITION_FAILED', 422, msg, { ruleCode }),
  invalidChoice: (choiceId: string) => new EngineError('INVALID_CHOICE', 422, 'Choice is not valid for this world version', { choiceId }),
  budgetExceeded: (msg = 'World spend budget exceeded') => new EngineError('WORLD_BUDGET_EXCEEDED', 429, msg),
  narrativeUnavailable: (msg = 'Narrative provider unavailable') => new EngineError('NARRATIVE_UNAVAILABLE', 503, msg),
  unknownCommand: (t: string) => new EngineError('UNKNOWN_COMMAND_TYPE', 400, 'Unknown command type in v1', { commandType: t }),
  unknownEvent: (t: string) => new EngineError('UNKNOWN_EVENT_TYPE', 400, 'Unknown event type in v1', { eventType: t }),
  invalidBlueprint: (reason: string, details?: Record<string, unknown>) =>
    new EngineError('INVALID_BLUEPRINT', 422, reason, details),
};
