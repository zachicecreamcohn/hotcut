export const ERROR_CODES = {
  GENERIC: 1,
  CONFIG_INVALID: 2,
  SOURCE_NOT_FOUND: 4,
  TARGET_NOT_FOUND: 4, // alias of SOURCE_NOT_FOUND for clarity when the target may be a shared service
  READY_TIMEOUT: 5,
  PROJECT_NOT_REGISTERED: 6,
  ALREADY_RUNNING: 7,
  PORT_UNAVAILABLE: 8,
  SHUTDOWN_IN_PROGRESS: 9,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class ProtocolError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}
