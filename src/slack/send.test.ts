import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebClient, ChatPostMessageResponse } from '@slack/web-api';
import { SlackMcpError, ErrorCode } from '../utils/errors.js';

// Mock all external dependencies
vi.mock('./client.js', () => ({
  getSlackClient: vi.fn(),
}));

vi.mock('../cache/channels.js', () => ({
  getChannelId: vi.fn(),
}));

vi.mock('../mentions/resolver.js', () => ({
  convertMentions: vi.fn(),
}));

import { sendMessage } from './send.js';
import { getSlackClient } from './client.js';
import { getChannelId } from '../cache/channels.js';
import { convertMentions } from '../mentions/resolver.js';

const mockGetSlackClient = vi.mocked(getSlackClient);
const mockGetChannelId = vi.mocked(getChannelId);
const mockConvertMentions = vi.mocked(convertMentions);

function createMockClient(postMessageResult?: Partial<ChatPostMessageResponse>): WebClient {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({
        ok: true,
        ts: '1234567890.123456',
        ...postMessageResult,
      }),
    },
  } as unknown as WebClient;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('sendMessage', () => {
  describe('happy path', () => {
    it('sends a message with Block Kit and returns success', async () => {
      const mockClient = createMockClient({ ts: '1111.2222' });
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C12345');
      mockConvertMentions.mockResolvedValue('hello world');

      const result = await sendMessage({
        channel_name: 'general',
        message: 'hello world',
      });

      expect(result).toEqual({
        status: 'success',
        message: 'Message sent successfully',
        channel_name: 'general',
        channel_id: 'C12345',
        message_ts: '1111.2222',
        sent_message: 'hello world',
        thread_ts: undefined,
      });

      // Verify Block Kit blocks were sent
      const postMessage = vi.mocked(mockClient.chat.postMessage);
      expect(postMessage).toHaveBeenCalledTimes(1);
      const callArgs = postMessage.mock.calls[0]?.[0];
      expect(callArgs).toBeDefined();
      expect(callArgs!.channel).toBe('C12345');
      expect(callArgs!.text).toBe('hello world');
      expect(callArgs!.blocks).toEqual([
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'hello world' },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: ':robot_face: Sent by AI assistant' },
          ],
        },
      ]);
      expect(callArgs!.unfurl_links).toBe(false);
      expect(callArgs!.unfurl_media).toBe(false);
    });

    it('sends a message with thread_ts for thread replies', async () => {
      const mockClient = createMockClient({ ts: '3333.4444' });
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C99999');
      mockConvertMentions.mockResolvedValue('thread reply');

      const result = await sendMessage({
        channel_name: 'dev',
        message: 'thread reply',
        thread_ts: '1718033467.085279',
      });

      expect(result.status).toBe('success');
      expect(result.thread_ts).toBe('1718033467.085279');

      const postMessage = vi.mocked(mockClient.chat.postMessage);
      const callArgs = postMessage.mock.calls[0]?.[0];
      expect(callArgs!.thread_ts).toBe('1718033467.085279');
    });

    it('passes message through convertMentions', async () => {
      const mockClient = createMockClient();
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C11111');
      mockConvertMentions.mockResolvedValue('hey <@U123> check this');

      const result = await sendMessage({
        channel_name: 'general',
        message: 'hey @john check this',
      });

      expect(mockConvertMentions).toHaveBeenCalledWith('hey @john check this', mockClient);
      expect(result.sent_message).toBe('hey <@U123> check this');
    });
  });

  describe('thread_ts validation', () => {
    it('throws SEND_FAILED for invalid thread_ts format', async () => {
      const mockClient = createMockClient();
      mockGetSlackClient.mockReturnValue(mockClient);

      try {
        await sendMessage({ channel_name: 'general', message: 'test', thread_ts: 'bad-format' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SlackMcpError);
        const slackErr = err as SlackMcpError;
        expect(slackErr.code).toBe(ErrorCode.SEND_FAILED);
        expect(slackErr.message).toContain('Invalid thread_ts format');
      }
    });

    it('accepts valid thread_ts format', async () => {
      const mockClient = createMockClient();
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C12345');
      mockConvertMentions.mockResolvedValue('test');

      const result = await sendMessage({
        channel_name: 'general',
        message: 'test',
        thread_ts: '1718033467.085279',
      });
      expect(result.status).toBe('success');
    });
  });

  describe('long messages', () => {
    it('sends plain text fallback for messages over 3000 chars', async () => {
      const longMessage = 'x'.repeat(3001);
      const mockClient = createMockClient({ ts: '7777.8888' });
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C12345');
      mockConvertMentions.mockResolvedValue(longMessage);

      const result = await sendMessage({
        channel_name: 'general',
        message: longMessage,
      });

      expect(result.status).toBe('success');
      expect(result.message).toContain('plain text fallback');

      const postMessage = vi.mocked(mockClient.chat.postMessage);
      expect(postMessage).toHaveBeenCalledTimes(1);
      const callArgs = postMessage.mock.calls[0]?.[0];
      expect(callArgs!.blocks).toBeUndefined();
      expect((callArgs!.text as string).startsWith(':robot_face:')).toBe(true);
    });

    it('sends Block Kit for messages at exactly 3000 chars', async () => {
      const exactMessage = 'x'.repeat(3000);
      const mockClient = createMockClient();
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C12345');
      mockConvertMentions.mockResolvedValue(exactMessage);

      const result = await sendMessage({
        channel_name: 'general',
        message: exactMessage,
      });

      expect(result.message).toBe('Message sent successfully');
      const postMessage = vi.mocked(mockClient.chat.postMessage);
      const callArgs = postMessage.mock.calls[0]?.[0];
      expect(callArgs!.blocks).toBeDefined();
    });
  });

  describe('channel not found', () => {
    it('throws CHANNEL_NOT_FOUND when channel cannot be resolved', async () => {
      const mockClient = createMockClient();
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue(null);
      mockConvertMentions.mockResolvedValue('hello');

      await expect(
        sendMessage({ channel_name: 'nonexistent', message: 'hello' })
      ).rejects.toThrow(SlackMcpError);

      try {
        await sendMessage({ channel_name: 'nonexistent', message: 'hello' });
      } catch (err) {
        expect(err).toBeInstanceOf(SlackMcpError);
        const slackErr = err as SlackMcpError;
        expect(slackErr.code).toBe(ErrorCode.CHANNEL_NOT_FOUND);
        expect(slackErr.message).toContain('nonexistent');
      }
    });
  });

  describe('Block Kit fallback', () => {
    it('falls back to plain text when Block Kit fails', async () => {
      const postMessage = vi.fn()
        .mockRejectedValueOnce(new Error('invalid_blocks'))
        .mockResolvedValueOnce({ ok: true, ts: '5555.6666' });

      const mockClient = { chat: { postMessage } } as unknown as WebClient;
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C77777');
      mockConvertMentions.mockResolvedValue('fallback msg');

      const result = await sendMessage({
        channel_name: 'general',
        message: 'fallback msg',
      });

      expect(result.status).toBe('success');
      expect(result.message).toContain('plain text fallback');
      expect(result.message_ts).toBe('5555.6666');

      // Second call should NOT include blocks
      const secondCallArgs = postMessage.mock.calls[1]?.[0];
      expect(secondCallArgs!.blocks).toBeUndefined();
      expect(secondCallArgs!.text).toBe(':robot_face: fallback msg');
    });

    it('throws mapped error when both Block Kit and fallback fail', async () => {
      const postMessage = vi.fn()
        .mockRejectedValue(new Error('channel_not_found'));

      const mockClient = { chat: { postMessage } } as unknown as WebClient;
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C88888');
      mockConvertMentions.mockResolvedValue('test');

      try {
        await sendMessage({ channel_name: 'deleted-channel', message: 'test' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SlackMcpError);
        const slackErr = err as SlackMcpError;
        expect(slackErr.code).toBe(ErrorCode.CHANNEL_NOT_FOUND);
      }
    });
  });

  describe('error mapping', () => {
    function setupDoubleFailure(errorMsg: string): void {
      const postMessage = vi.fn()
        .mockRejectedValue(new Error(errorMsg));

      const mockClient = { chat: { postMessage } } as unknown as WebClient;
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C00000');
      mockConvertMentions.mockResolvedValue('test');
    }

    it('maps not_in_channel to SEND_FAILED', async () => {
      setupDoubleFailure('not_in_channel');

      try {
        await sendMessage({ channel_name: 'private', message: 'test' });
        expect.unreachable('should have thrown');
      } catch (err) {
        const slackErr = err as SlackMcpError;
        expect(slackErr.code).toBe(ErrorCode.SEND_FAILED);
        expect(slackErr.message).toContain('not a member');
      }
    });

    it('maps restricted_action to SEND_FAILED', async () => {
      setupDoubleFailure('restricted_action');

      try {
        await sendMessage({ channel_name: 'locked', message: 'test' });
        expect.unreachable('should have thrown');
      } catch (err) {
        const slackErr = err as SlackMcpError;
        expect(slackErr.code).toBe(ErrorCode.SEND_FAILED);
        expect(slackErr.message).toContain('permission');
      }
    });

    it('maps thread_not_found to SEND_FAILED', async () => {
      setupDoubleFailure('thread_not_found');

      try {
        await sendMessage({ channel_name: 'general', message: 'test' });
        expect.unreachable('should have thrown');
      } catch (err) {
        const slackErr = err as SlackMcpError;
        expect(slackErr.code).toBe(ErrorCode.SEND_FAILED);
        expect(slackErr.message).toContain('Thread not found');
      }
    });

    it('maps unknown errors to generic SEND_FAILED', async () => {
      setupDoubleFailure('some_unknown_api_error');

      try {
        await sendMessage({ channel_name: 'general', message: 'test' });
        expect.unreachable('should have thrown');
      } catch (err) {
        const slackErr = err as SlackMcpError;
        expect(slackErr.code).toBe(ErrorCode.SEND_FAILED);
        expect(slackErr.message).toContain('Slack API error');
      }
    });

    it('handles non-Error thrown objects in fallback', async () => {
      const postMessage = vi.fn()
        .mockRejectedValueOnce('string-error')
        .mockRejectedValueOnce('string-error-2');

      const mockClient = { chat: { postMessage } } as unknown as WebClient;
      mockGetSlackClient.mockReturnValue(mockClient);
      mockGetChannelId.mockResolvedValue('C00000');
      mockConvertMentions.mockResolvedValue('test');

      try {
        await sendMessage({ channel_name: 'general', message: 'test' });
        expect.unreachable('should have thrown');
      } catch (err) {
        const slackErr = err as SlackMcpError;
        expect(slackErr.code).toBe(ErrorCode.SEND_FAILED);
        expect(slackErr.message).toContain('string-error');
      }
    });
  });
});
