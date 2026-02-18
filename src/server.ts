import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { sendMessage } from './slack/send.js';
import { SlackMcpError, ErrorCode } from './utils/errors.js';

const SERVER_INSTRUCTIONS = `Slack message sender. Use send_message to post messages to channels or reply to threads.
@mentions like @username are automatically resolved to Slack user IDs.`;

export function createServer(): Server {
  const server = new Server(
    {
      name: 'mcp-notify',
      version: '1.0.0',
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
        description: `Send a message to a Slack channel or thread as the authenticated user. Messages are tagged with a :robot_face: indicator so recipients know AI assisted.

WHEN TO USE: User asks to post, send, write, notify, tell, or reply in Slack.

MENTIONS: Write @username or @groupname naturally — they are auto-resolved to Slack IDs. Do NOT manually construct <@U...> syntax.

THREAD REPLIES: To reply in a thread, provide thread_ts. Extract from Slack URLs by converting the p-prefixed ID: p1718033467085279 → 1718033467.085279 (insert dot before last 6 digits).

CRITICAL — Use Slack mrkdwn, NOT Markdown:
  *bold*          (NOT **bold**)
  _italic_        (NOT *italic*)
  ~strikethrough~
  \`inline code\`
  \`\`\`code block\`\`\`
  <https://url.com|link text>  (NOT [text](url))
  > blockquote
  • or - for bullets, 1. for numbered lists
  :emoji_name: for emoji

NEVER use: **bold**, [link](url), # headers, tables, ---, ![images]. These render as literal text in Slack.`,
        inputSchema: {
          type: 'object',
          properties: {
            channel_name: {
              type: 'string',
              description: 'Channel name without # prefix (e.g. "general", "team-backend"). Works with public and private channels you have access to.',
            },
            message: {
              type: 'string',
              description: 'Message content in Slack mrkdwn format. IMPORTANT: Use *bold* not **bold**, use <url|text> not [text](url). @mentions like @username are auto-resolved.',
            },
            thread_ts: {
              type: 'string',
              description: 'Thread timestamp to reply in a thread (e.g. "1718033467.085279"). From Slack URLs: strip the "p" prefix and insert a dot before the last 6 digits.',
            },
          },
          required: ['channel_name', 'message'],
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
          if (!params?.channel_name || typeof params.channel_name !== 'string') {
            throw new SlackMcpError(ErrorCode.SEND_FAILED, 'channel_name is required and must be a string');
          }
          if (!params?.message || typeof params.message !== 'string') {
            throw new SlackMcpError(ErrorCode.SEND_FAILED, 'message is required and must be a string');
          }
          const result = await sendMessage({
            channel_name: params.channel_name,
            message: params.message,
            thread_ts: typeof params.thread_ts === 'string' ? params.thread_ts : undefined,
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
      throw new Error(String(error));
    }
  });

  return server;
}

export async function runServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
