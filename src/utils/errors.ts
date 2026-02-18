export const ErrorCode = {
  CHANNEL_NOT_FOUND: 'CHANNEL_NOT_FOUND',
  SEND_FAILED: 'SEND_FAILED',
  SYNC_FAILED: 'SYNC_FAILED',
  CONFIG_MISSING: 'CONFIG_MISSING',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

export class SlackMcpError extends Error {
  public readonly code: ErrorCodeType;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCodeType, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SlackMcpError';
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SlackMcpError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
