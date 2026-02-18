import { WebClient } from '@slack/web-api';
import { SlackMcpError, ErrorCode } from '../utils/errors.js';

let _client: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (_client) return _client;

  const token = process.env.SLACK_MCP_XOXC_TOKEN;
  const xoxd = process.env.SLACK_MCP_XOXD_TOKEN;

  if (!token) {
    throw new SlackMcpError(ErrorCode.CONFIG_MISSING, 'SLACK_MCP_XOXC_TOKEN environment variable is required');
  }
  if (!xoxd) {
    throw new SlackMcpError(ErrorCode.CONFIG_MISSING, 'SLACK_MCP_XOXD_TOKEN environment variable is required');
  }

  _client = new WebClient(token, {
    headers: { Cookie: `d=${xoxd}` },
  });
  return _client;
}
