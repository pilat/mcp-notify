import { WebClient } from '@slack/web-api';
import { SlackMcpError, ErrorCode } from '../utils/errors.js';

let _client: WebClient | null = null;
let _botMode = false;

export function getSlackClient(): WebClient {
  if (_client) return _client;

  const botToken = process.env.SLACK_MCP_BOT_TOKEN;
  const xoxcToken = process.env.SLACK_MCP_XOXC_TOKEN;
  const xoxd = process.env.SLACK_MCP_XOXD_TOKEN;

  if (botToken && xoxcToken) {
    throw new SlackMcpError(
      ErrorCode.CONFIG_MISSING,
      'Both SLACK_MCP_BOT_TOKEN and SLACK_MCP_XOXC_TOKEN are set. Use one or the other, not both.',
    );
  }

  if (botToken) {
    _botMode = true;
    _client = new WebClient(botToken);
    return _client;
  }

  if (!xoxcToken) {
    throw new SlackMcpError(
      ErrorCode.CONFIG_MISSING,
      'Either SLACK_MCP_BOT_TOKEN or SLACK_MCP_XOXC_TOKEN environment variable is required',
    );
  }
  if (!xoxd) {
    throw new SlackMcpError(ErrorCode.CONFIG_MISSING, 'SLACK_MCP_XOXD_TOKEN environment variable is required');
  }

  _botMode = false;
  _client = new WebClient(xoxcToken, {
    headers: { Cookie: `d=${xoxd}` },
  });
  return _client;
}

export function isBotMode(): boolean {
  return _botMode;
}
