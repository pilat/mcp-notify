import type { SendMessageParams, SendMessageResult } from '../types.js';
import { SlackMcpError, ErrorCode } from '../utils/errors.js';
import { getSlackClient } from './client.js';
import { getChannelId } from '../cache/channels.js';
import { convertMentions } from '../mentions/resolver.js';

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  const client = getSlackClient();

  // Resolve mentions
  const convertedMessage = await convertMentions(params.message, client);

  // Resolve channel
  const channelId = await getChannelId(params.channel_name, client);
  if (!channelId) {
    throw new SlackMcpError(
      ErrorCode.CHANNEL_NOT_FOUND,
      `Channel "#${params.channel_name}" not found. Check the channel name and ensure you have access.`
    );
  }

  // Build Block Kit blocks
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: convertedMessage },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: ':robot_face: Sent by AI assistant' },
      ],
    },
  ];

  const baseArgs = {
    channel: channelId,
    unfurl_links: false,
    unfurl_media: false,
    ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}),
  };

  try {
    // Try with Block Kit first
    const result = await client.chat.postMessage({
      ...baseArgs,
      text: convertedMessage,
      blocks,
    });

    return {
      status: 'success',
      message: 'Message sent successfully',
      channel_name: params.channel_name,
      channel_id: channelId,
      message_ts: result.ts,
      sent_message: convertedMessage,
      thread_ts: params.thread_ts,
    };
  } catch (blockKitError: unknown) {
    // Fallback to plain text without blocks
    try {
      const result = await client.chat.postMessage({
        ...baseArgs,
        text: `:robot_face: ${convertedMessage}`,
      });

      return {
        status: 'success',
        message: 'Message sent successfully (plain text fallback)',
        channel_name: params.channel_name,
        channel_id: channelId,
        message_ts: result.ts,
        sent_message: convertedMessage,
        thread_ts: params.thread_ts,
      };
    } catch {
      // Both failed — report the original Block Kit error with specifics
      const err = blockKitError instanceof Error ? blockKitError : new Error(String(blockKitError));
      throw mapSlackError(err, params.channel_name);
    }
  }
}

function mapSlackError(error: Error, channelName: string): SlackMcpError {
  const msg = error.message;

  if (msg.includes('channel_not_found')) {
    return new SlackMcpError(
      ErrorCode.CHANNEL_NOT_FOUND,
      `Channel "#${channelName}" not found. It may not exist or you may not have access.`
    );
  }
  if (msg.includes('not_in_channel')) {
    return new SlackMcpError(
      ErrorCode.SEND_FAILED,
      `You are not a member of "#${channelName}". Join the channel first.`
    );
  }
  if (msg.includes('restricted_action')) {
    return new SlackMcpError(
      ErrorCode.SEND_FAILED,
      `Restricted action: you don't have permission to post in "#${channelName}".`
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
