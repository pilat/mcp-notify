# mcp-notify

Minimal MCP server for sending Slack messages as user (xoxc + cookie auth). Fire-and-forget — single `send_message` tool, nothing else.

> **Looking for a full-featured Slack MCP?** Check out [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server) — it supports reading, searching, reactions, threads, DMs, and much more. We recommend it for most use cases.
>
> This project exists because we needed two things it doesn't offer:
> - **Bot signature** — every message gets a `:robot_face:` context block so it's clear the message was sent by an AI assistant, not a human
> - **Concurrent safety** — SQLite with WAL mode and check-lock-recheck sync pattern, safe for multiple MCP instances running in parallel

## Installation

### Claude Code

Add to your MCP config (`~/.claude/settings.json` or project settings):

```json
{
  "mcpServers": {
    "mcp-notify": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@pilat/mcp-notify"],
      "env": {
        "SLACK_MCP_XOXC_TOKEN": "xoxc-...",
        "SLACK_MCP_XOXD_TOKEN": "xoxd-..."
      }
    }
  }
}
```

### Other MCP clients

Use `npx @pilat/mcp-notify` as the command with stdio transport. Pass credentials as environment variables:

```bash
SLACK_MCP_XOXC_TOKEN=xoxc-... SLACK_MCP_XOXD_TOKEN=xoxd-... npx @pilat/mcp-notify
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_MCP_XOXC_TOKEN` | Yes | User's `xoxc-...` token |
| `SLACK_MCP_XOXD_TOKEN` | Yes | User's `xoxd-...` session token (value of the `d` cookie) |
| `SLACK_MCP_DATA_DIR` | No | Custom path for SQLite cache (default: `~/.local/share/mcp-notify`) |

### How to get credentials

1. Open Slack in browser (not desktop app)
2. Open DevTools → Network tab
3. Make any action in Slack (switch channel, send message)
4. Find any request to `api.slack.com` → Headers tab
5. **SLACK_MCP_XOXC_TOKEN**: from request payload, find `token=xoxc-...`
6. **SLACK_MCP_XOXD_TOKEN**: from Cookie header, find `d=xoxd-...` — copy only the `xoxd-...` part (without `d=`)

## Architecture

Single tool: `send_message`. Messages are sent with Block Kit (section + context `:robot_face:`) with plain text fallback.

- **SQLite cache** (`~/.local/share/mcp-notify/data.db`, WAL mode) — channels, users, user groups with lazy sync on first cache miss, 24h TTL
- **Mention resolution** — `@username` → `<@U123>`, `@grouphandle` → `<!subteam^ID>`. Groups take priority. Resolved in parallel.
- **Concurrent sync safety** — CAS-based check-lock-recheck pattern via `sync_meta` table
