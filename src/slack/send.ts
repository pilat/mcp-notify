import type { SendMessageParams, SendMessageResult } from '../types.js';
import { SlackMcpError, ErrorCode } from '../utils/errors.js';
import { getSlackClient, isBotMode } from './client.js';
import { getChannelId } from '../cache/channels.js';
import { convertMentions } from '../mentions/resolver.js';

const THREAD_TS_RE = /^\d+\.\d{6}$/;
const BLOCK_KIT_TEXT_LIMIT = 3000;

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  const client = getSlackClient();

  // Validate thread_ts format
  if (params.thread_ts && !THREAD_TS_RE.test(params.thread_ts)) {
    throw new SlackMcpError(
      ErrorCode.SEND_FAILED,
      `Invalid thread_ts format "${params.thread_ts}". Expected format: "1234567890.123456".`
    );
  }

  // Validate reply_broadcast requires thread_ts
  if (params.reply_broadcast && !params.thread_ts) {
    throw new SlackMcpError(
      ErrorCode.SEND_FAILED,
      'reply_broadcast requires thread_ts. You can only broadcast a thread reply to the channel.'
    );
  }

  // Resolve mentions
  const convertedMessage = await convertMentions(params.message, client);

  // Resolve channel
  const channelId = await getChannelId(params.channel, client);
  if (!channelId) {
    throw new SlackMcpError(
      ErrorCode.CHANNEL_NOT_FOUND,
      `Channel "${params.channel}" not found (tried as both name and ID). Verify it exists and you have access.`
    );
  }

  const sharedArgs = { channel: channelId, unfurl_links: false, unfurl_media: false };

  const baseArgs = params.reply_broadcast && params.thread_ts
    ? { ...sharedArgs, thread_ts: params.thread_ts, reply_broadcast: true }
    : params.thread_ts
      ? { ...sharedArgs, thread_ts: params.thread_ts }
      : sharedArgs;

  const makeResult = (ts: string | undefined, fallback: boolean): SendMessageResult => ({
    status: 'success',
    message: fallback ? 'Message sent successfully (plain text fallback)' : 'Message sent successfully',
    channel: params.channel,
    channel_id: channelId,
    message_ts: ts,
    sent_message: convertedMessage,
    thread_ts: params.thread_ts,
    reply_broadcast: params.reply_broadcast,
  });

  // Skip Block Kit if message exceeds the 3000-char section limit
  if (convertedMessage.length > BLOCK_KIT_TEXT_LIMIT) {
    return sendPlainText(client, baseArgs, convertedMessage, params.channel, makeResult);
  }

  // Build Block Kit blocks
  const sectionBlock = {
    type: 'section' as const,
    text: { type: 'mrkdwn' as const, text: convertedMessage },
  };

  const blocks = isBotMode()
    ? [sectionBlock]
    : [
        sectionBlock,
        {
          type: 'context' as const,
          elements: [
            { type: 'mrkdwn' as const, text: ':robot_face: Sent by AI assistant' },
          ],
        },
      ];

  try {
    const result = await client.chat.postMessage({
      ...baseArgs,
      text: convertedMessage,
      blocks,
    });
    return makeResult(result.ts, false);
  } catch (blockKitError: unknown) {
    // Fallback to plain text without blocks
    try {
      return await sendPlainText(client, baseArgs, convertedMessage, params.channel, makeResult);
    } catch {
      const err = blockKitError instanceof Error ? blockKitError : new Error(String(blockKitError));
      throw mapSlackError(err, params.channel);
    }
  }
}

async function sendPlainText(
  client: ReturnType<typeof getSlackClient>,
  baseArgs: { channel: string; unfurl_links: boolean; unfurl_media: boolean; thread_ts?: string },
  message: string,
  channelName: string,
  makeResult: (ts: string | undefined, fallback: boolean) => SendMessageResult,
): Promise<SendMessageResult> {
  try {
    const result = await client.chat.postMessage({
      ...baseArgs,
      text: isBotMode() ? message : `:robot_face: ${message}`,
    });
    return makeResult(result.ts, true);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error), { cause: error });
    throw mapSlackError(err, channelName);
  }
}

function mapSlackError(error: Error, channelName: string): SlackMcpError {
  const msg = error.message;

  if (msg.includes('channel_not_found')) {
    return new SlackMcpError(
      ErrorCode.CHANNEL_NOT_FOUND,
      `Channel "${channelName}" not found. It may not exist or you may not have access.`
    );
  }
  if (msg.includes('not_in_channel')) {
    return new SlackMcpError(
      ErrorCode.SEND_FAILED,
      `You are not a member of "${channelName}". Join the channel first.`
    );
  }
  if (msg.includes('restricted_action')) {
    return new SlackMcpError(
      ErrorCode.SEND_FAILED,
      `Restricted action: you don't have permission to post in "${channelName}".`
    );
  }
  if (msg.includes('thread_not_found')) {
    return new SlackMcpError(
      ErrorCode.SEND_FAILED,
      'Thread not found. The thread_ts may be invalid or the parent message was deleted.'
    );
  }

  return new SlackMcpError(ErrorCode.SEND_FAILED, `Slack API error: ${msg}`);
}
