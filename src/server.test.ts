import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackMcpError, ErrorCode } from './utils/errors.js';

vi.mock('./slack/send.js', () => ({
  sendMessage: vi.fn(),
}));


// Capture handlers registered by createServer
type Handler = (request: unknown) => Promise<unknown>;
let handlers: Map<string, Handler>;

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  return {
    Server: class MockServer {
      setRequestHandler(schema: { method?: string }, handler: Handler): void {
        const method = schema.method ?? 'unknown';
        handlers.set(method, handler);
      }
      connect = vi.fn();
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: { method: 'tools/list' },
  CallToolRequestSchema: { method: 'tools/call' },
}));

import { createServer } from './server.js';
import { sendMessage } from './slack/send.js';

const mockSendMessage = vi.mocked(sendMessage);

function getListToolsHandler(): Handler {
  const h = handlers.get('tools/list');
  if (!h) throw new Error('ListTools handler not registered');
  return h;
}

function getCallToolHandler(): Handler {
  const h = handlers.get('tools/call');
  if (!h) throw new Error('CallTool handler not registered');
  return h;
}

beforeEach(() => {
  mockSendMessage.mockReset();
  handlers = new Map();
  createServer();
});

describe('createServer', () => {
  it('registers both ListTools and CallTool handlers', () => {
    expect(handlers.has('tools/list')).toBe(true);
    expect(handlers.has('tools/call')).toBe(true);
  });
});

describe('ListTools handler', () => {
  it('returns a single send_message tool', async () => {
    const response = await getListToolsHandler()({}) as { tools: Array<{ name: string }> };

    expect(response.tools).toHaveLength(1);
    expect(response.tools[0]!.name).toBe('send_message');
  });

  it('tool has correct required properties', async () => {
    const response = await getListToolsHandler()({}) as { tools: Array<{ inputSchema: { required: string[] } }> };

    expect(response.tools[0]!.inputSchema.required).toEqual(['channel_name', 'message']);
  });

  it('tool describes channel_name, message, and thread_ts properties', async () => {
    const response = await getListToolsHandler()({}) as {
      tools: Array<{ inputSchema: { properties: Record<string, unknown> } }>;
    };

    const props = response.tools[0]!.inputSchema.properties;
    expect(props).toHaveProperty('channel_name');
    expect(props).toHaveProperty('message');
    expect(props).toHaveProperty('thread_ts');
  });
});

describe('CallTool handler', () => {
  describe('send_message', () => {
    it('calls sendMessage and returns formatted result', async () => {
      mockSendMessage.mockResolvedValue({
        status: 'success',
        message: 'Message sent successfully',
        channel_name: 'general',
        channel_id: 'C123',
        message_ts: '111.222',
        sent_message: 'hello',
      });

      const response = await getCallToolHandler()({
        params: {
          name: 'send_message',
          arguments: { channel_name: 'general', message: 'hello' },
        },
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(mockSendMessage).toHaveBeenCalledWith({
        channel_name: 'general',
        message: 'hello',
        thread_ts: undefined,
      });

      expect(response.content).toHaveLength(1);
      expect(response.content[0]!.type).toBe('text');
      const parsed = JSON.parse(response.content[0]!.text) as Record<string, unknown>;
      expect(parsed['status']).toBe('success');
      expect(response.isError).toBeUndefined();
    });

    it('passes thread_ts when provided', async () => {
      mockSendMessage.mockResolvedValue({
        status: 'success',
        message: 'sent',
        thread_ts: '999.888',
      });

      await getCallToolHandler()({
        params: {
          name: 'send_message',
          arguments: { channel_name: 'dev', message: 'reply', thread_ts: '999.888' },
        },
      });

      expect(mockSendMessage).toHaveBeenCalledWith({
        channel_name: 'dev',
        message: 'reply',
        thread_ts: '999.888',
      });
    });

    it('ignores non-string thread_ts', async () => {
      mockSendMessage.mockResolvedValue({
        status: 'success',
        message: 'sent',
      });

      await getCallToolHandler()({
        params: {
          name: 'send_message',
          arguments: { channel_name: 'dev', message: 'hello', thread_ts: 12345 },
        },
      });

      expect(mockSendMessage).toHaveBeenCalledWith({
        channel_name: 'dev',
        message: 'hello',
        thread_ts: undefined,
      });
    });
  });

  describe('validation errors', () => {
    it('returns error when channel_name is missing', async () => {
      const response = await getCallToolHandler()({
        params: {
          name: 'send_message',
          arguments: { message: 'hello' },
        },
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0]!.text) as Record<string, unknown>;
      expect(parsed['code']).toBe('SEND_FAILED');
      expect(parsed['message']).toContain('channel_name');
    });

    it('returns error when message is missing', async () => {
      const response = await getCallToolHandler()({
        params: {
          name: 'send_message',
          arguments: { channel_name: 'general' },
        },
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0]!.text) as Record<string, unknown>;
      expect(parsed['code']).toBe('SEND_FAILED');
      expect(parsed['message']).toContain('message');
    });

    it('returns error when channel_name is not a string', async () => {
      const response = await getCallToolHandler()({
        params: {
          name: 'send_message',
          arguments: { channel_name: 123, message: 'hello' },
        },
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(response.isError).toBe(true);
    });

    it('returns error when arguments are undefined', async () => {
      const response = await getCallToolHandler()({
        params: {
          name: 'send_message',
          arguments: undefined,
        },
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(response.isError).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns SlackMcpError as JSON with isError flag', async () => {
      mockSendMessage.mockRejectedValue(
        new SlackMcpError(ErrorCode.CHANNEL_NOT_FOUND, 'Channel not found')
      );

      const response = await getCallToolHandler()({
        params: {
          name: 'send_message',
          arguments: { channel_name: 'nonexistent', message: 'hello' },
        },
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0]!.text) as Record<string, unknown>;
      expect(parsed['code']).toBe('CHANNEL_NOT_FOUND');
      expect(parsed['name']).toBe('SlackMcpError');
    });

    it('re-throws generic Error instances', async () => {
      mockSendMessage.mockRejectedValue(new Error('unexpected'));

      await expect(
        getCallToolHandler()({
          params: {
            name: 'send_message',
            arguments: { channel_name: 'general', message: 'hello' },
          },
        })
      ).rejects.toThrow('unexpected');
    });

    it('wraps non-Error thrown values in Error', async () => {
      mockSendMessage.mockRejectedValue('string-error');

      await expect(
        getCallToolHandler()({
          params: {
            name: 'send_message',
            arguments: { channel_name: 'general', message: 'hello' },
          },
        })
      ).rejects.toThrow('string-error');
    });
  });

  describe('unknown tool', () => {
    it('throws Error for unknown tool name', async () => {
      await expect(
        getCallToolHandler()({
          params: { name: 'unknown_tool', arguments: {} },
        })
      ).rejects.toThrow('Unknown tool: unknown_tool');
    });
  });
});
