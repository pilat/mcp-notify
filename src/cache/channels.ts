import type { WebClient } from '@slack/web-api';
import { getDb } from './db.js';
import { syncIfNeeded, CACHE_TTL_MS } from './sync.js';

function lookupChannelByName(name: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id FROM channels WHERE name = ? AND synced_at > ?'
  ).get(name, Date.now() - CACHE_TTL_MS) as { id: string } | undefined;
  return row?.id ?? null;
}

function lookupChannelById(id: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id FROM channels WHERE id = ? AND synced_at > ?'
  ).get(id, Date.now() - CACHE_TTL_MS) as { id: string } | undefined;
  return row?.id ?? null;
}

async function fetchChannels(client: WebClient): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const channels: { id: string; name: string }[] = [];

  let cursor: string | undefined;
  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000,
      cursor,
    });

    for (const ch of result.channels ?? []) {
      if (ch.id && ch.name) {
        channels.push({ id: ch.id, name: ch.name });
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const insert = db.prepare(
    'INSERT OR REPLACE INTO channels (id, name, synced_at) VALUES (?, ?, ?)'
  );
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM channels').run();
    for (const ch of channels) {
      insert.run(ch.id, ch.name, now);
    }
  });
  tx();
}

export async function getChannelId(input: string, client: WebClient): Promise<string | null> {
  const byName = lookupChannelByName(input);
  if (byName !== null) return byName;

  const byId = lookupChannelById(input);
  if (byId !== null) return byId;

  return syncIfNeeded(
    'channels',
    () => lookupChannelByName(input) ?? lookupChannelById(input),
    () => fetchChannels(client),
  );
}
