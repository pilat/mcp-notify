import { describe, it, expect } from 'vitest';
import { SlackMcpError, ErrorCode } from './errors.js';
import type { ErrorCodeType } from './errors.js';

describe('ErrorCode', () => {
  it('has all expected error codes', () => {
    expect(ErrorCode.CHANNEL_NOT_FOUND).toBe('CHANNEL_NOT_FOUND');
    expect(ErrorCode.SEND_FAILED).toBe('SEND_FAILED');
    expect(ErrorCode.SYNC_FAILED).toBe('SYNC_FAILED');
    expect(ErrorCode.CONFIG_MISSING).toBe('CONFIG_MISSING');
  });

  it('is a const object (immutable)', () => {
    const keys = Object.keys(ErrorCode);
    expect(keys).toHaveLength(4);
  });
});

describe('SlackMcpError', () => {
  it('creates an error with code and message', () => {
    const err = new SlackMcpError(ErrorCode.SEND_FAILED, 'something broke');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SlackMcpError);
    expect(err.name).toBe('SlackMcpError');
    expect(err.code).toBe('SEND_FAILED');
    expect(err.message).toBe('something broke');
    expect(err.details).toBeUndefined();
  });

  it('creates an error with details', () => {
    const details = { channel: 'general', attempt: 3 };
    const err = new SlackMcpError(ErrorCode.CHANNEL_NOT_FOUND, 'not found', details);

    expect(err.code).toBe('CHANNEL_NOT_FOUND');
    expect(err.details).toEqual(details);
  });

  it('has a stack trace', () => {
    const err = new SlackMcpError(ErrorCode.SYNC_FAILED, 'sync broke');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('SlackMcpError');
  });

  describe('toJSON', () => {
    it('serializes without details', () => {
      const err = new SlackMcpError(ErrorCode.CONFIG_MISSING, 'no token');
      const json = err.toJSON();

      expect(json).toEqual({
        name: 'SlackMcpError',
        code: 'CONFIG_MISSING',
        message: 'no token',
        details: undefined,
      });
    });

    it('serializes with details', () => {
      const err = new SlackMcpError(ErrorCode.SEND_FAILED, 'failed', { foo: 'bar' });
      const json = err.toJSON();

      expect(json).toEqual({
        name: 'SlackMcpError',
        code: 'SEND_FAILED',
        message: 'failed',
        details: { foo: 'bar' },
      });
    });

    it('produces valid JSON via JSON.stringify', () => {
      const err = new SlackMcpError(ErrorCode.SEND_FAILED, 'test', { num: 42 });
      const parsed = JSON.parse(JSON.stringify(err.toJSON())) as Record<string, unknown>;

      expect(parsed['name']).toBe('SlackMcpError');
      expect(parsed['code']).toBe('SEND_FAILED');
      expect(parsed['message']).toBe('test');
      expect(parsed['details']).toEqual({ num: 42 });
    });
  });

  it('works with type narrowing', () => {
    const err: Error = new SlackMcpError(ErrorCode.SEND_FAILED, 'narrowing test');

    if (err instanceof SlackMcpError) {
      const _code: ErrorCodeType = err.code;
      expect(_code).toBe('SEND_FAILED');
    } else {
      expect.unreachable('should be instance of SlackMcpError');
    }
  });
});
