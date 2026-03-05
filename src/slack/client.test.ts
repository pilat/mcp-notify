import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to reset module state between tests since client.ts uses module-level singletons
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function importClient(): Promise<typeof import('./client.js')> {
  return await import('./client.js');
}

describe('getSlackClient', () => {
  it('creates client with bot token when SLACK_MCP_BOT_TOKEN is set', async () => {
    vi.stubEnv('SLACK_MCP_BOT_TOKEN', 'xoxb-test-bot-token');
    vi.stubEnv('SLACK_MCP_XOXC_TOKEN', '');
    vi.stubEnv('SLACK_MCP_XOXD_TOKEN', '');

    const { getSlackClient, isBotMode } = await importClient();
    const client = getSlackClient();

    expect(client).toBeDefined();
    expect(isBotMode()).toBe(true);
  });

  it('creates client with xoxc+xoxd when user token is set', async () => {
    vi.stubEnv('SLACK_MCP_BOT_TOKEN', '');
    vi.stubEnv('SLACK_MCP_XOXC_TOKEN', 'xoxc-test-token');
    vi.stubEnv('SLACK_MCP_XOXD_TOKEN', 'xoxd-test-cookie');

    const { getSlackClient, isBotMode } = await importClient();
    const client = getSlackClient();

    expect(client).toBeDefined();
    expect(isBotMode()).toBe(false);
  });

  it('throws CONFIG_MISSING when both bot and user tokens are set', async () => {
    vi.stubEnv('SLACK_MCP_BOT_TOKEN', 'xoxb-test');
    vi.stubEnv('SLACK_MCP_XOXC_TOKEN', 'xoxc-test');

    const { getSlackClient } = await importClient();

    try {
      getSlackClient();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('CONFIG_MISSING');
      expect((err as Error).message).toContain('both');
    }
  });

  it('throws CONFIG_MISSING when neither token is set', async () => {
    vi.stubEnv('SLACK_MCP_BOT_TOKEN', '');
    vi.stubEnv('SLACK_MCP_XOXC_TOKEN', '');

    const { getSlackClient } = await importClient();

    try {
      getSlackClient();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('CONFIG_MISSING');
    }
  });

  it('throws CONFIG_MISSING when xoxc is set without xoxd', async () => {
    vi.stubEnv('SLACK_MCP_BOT_TOKEN', '');
    vi.stubEnv('SLACK_MCP_XOXC_TOKEN', 'xoxc-test');
    vi.stubEnv('SLACK_MCP_XOXD_TOKEN', '');

    const { getSlackClient } = await importClient();

    try {
      getSlackClient();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('CONFIG_MISSING');
      expect((err as Error).message).toContain('SLACK_MCP_XOXD_TOKEN');
    }
  });

  it('returns the same singleton on subsequent calls', async () => {
    vi.stubEnv('SLACK_MCP_BOT_TOKEN', 'xoxb-test');
    vi.stubEnv('SLACK_MCP_XOXC_TOKEN', '');

    const { getSlackClient } = await importClient();
    const client1 = getSlackClient();
    const client2 = getSlackClient();

    expect(client1).toBe(client2);
  });
});
