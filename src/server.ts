import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { sendMessage } from './slack/send.js';
import { SlackMcpError, ErrorCode } from './utils/errors.js';

const SERVER_INSTRUCTIONS = `Slack message sender (write-only). Single tool: send_message. @mentions are auto-resolved. Uses Slack mrkdwn, not Markdown.`;

export function createServer(): Server {
  const server = new Server(
    {
      name: 'mcp-notify',
      version: '1.3.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'send_message',
        description: `Send a message to a Slack channel or thread. In user-token mode, messages are tagged with :robot_face: so recipients know it was AI-assisted. In bot-token mode, the app identity serves this purpose.

NOTE: This tool posts to channels only. DMs are not supported.

MENTIONS: Write @username or @groupname naturally — they are auto-resolved. Do NOT construct <@U...> syntax manually.

SLACK URLs: When given a Slack URL like .../archives/C0AGCGG628K/p1718033467085279:
  - Channel ID: the segment after /archives/ → pass as channel
  - Thread timestamp: strip "p", insert dot before last 6 digits → "1718033467.085279"
  Prefer channel ID over channel name when both are available.

FORMAT — Slack mrkdwn (NOT Markdown):
  *bold*  _italic_  ~strike~  \`code\`  \`\`\`block\`\`\`
  <https://url|link text>  > quote  • bullets
  :emoji_name:
  NEVER use: **bold**, [text](url), # headers, --- rules, tables, ![images].`,
        inputSchema: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Channel name (without #) or channel ID. Examples: "general", "C0AGCGG628K". Prefer ID when available; never guess a name you weren\'t given.',
            },
            message: {
              type: 'string',
              description: 'Message text in Slack mrkdwn format. @mentions are auto-resolved.',
            },
            thread_ts: {
              type: 'string',
              description: 'Thread timestamp for replying in a thread (e.g. "1718033467.085279"). See URL extraction in tool description.',
            },
            reply_broadcast: {
              type: 'boolean',
              description: 'When replying in a thread (thread_ts required), also post the message to the channel. Like the "Also send to #channel" checkbox in Slack.',
            },
          },
          required: ['channel', 'message'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'send_message': {
          const params = args as Record<string, unknown> | undefined;
          if (!params?.channel || typeof params.channel !== 'string') {
            throw new SlackMcpError(ErrorCode.SEND_FAILED, 'channel is required and must be a string');
          }
          if (!params?.message || typeof params.message !== 'string') {
            throw new SlackMcpError(ErrorCode.SEND_FAILED, 'message is required and must be a string');
          }
          const result = await sendMessage({
            channel: params.channel,
            message: params.message,
            thread_ts: typeof params.thread_ts === 'string' ? params.thread_ts : undefined,
            reply_broadcast: typeof params.reply_broadcast === 'boolean' ? params.reply_broadcast : undefined,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      if (error instanceof SlackMcpError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toJSON(), null, 2) }],
          isError: true,
        };
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error), { cause: error });
    }
  });

  return server;
}

export async function runServer(): Promise<Server> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
