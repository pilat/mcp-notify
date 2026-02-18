import type { WebClient } from '@slack/web-api';
import { getDb } from './db.js';
import { syncIfNeeded, isTableSynced, CACHE_TTL_MS } from './sync.js';

// --- Users ---

function lookupUser(name: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id FROM users WHERE name = ? AND synced_at > ?'
  ).get(name, Date.now() - CACHE_TTL_MS) as { id: string } | undefined;
  return row?.id ?? null;
}

async function fetchUsers(client: WebClient): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const users: { id: string; name: string }[] = [];

  let cursor: string | undefined;
  do {
    const result = await client.users.list({ limit: 1000, cursor });

    for (const member of result.members ?? []) {
      if (member.id && member.name) {
        users.push({ id: member.id, name: member.name });
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const insert = db.prepare(
    'INSERT OR REPLACE INTO users (id, name, synced_at) VALUES (?, ?, ?)'
  );
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM users').run();
    for (const u of users) {
      insert.run(u.id, u.name, now);
    }
  });
  tx();
}

export async function resolveUser(name: string, client: WebClient): Promise<string | null> {
  const cached = lookupUser(name);
  if (cached !== null) return cached;

  if (!isTableSynced('users')) {
    return syncIfNeeded('users', () => lookupUser(name), () => fetchUsers(client));
  }

  return null;
}

// --- User Groups ---

function lookupUserGroup(handle: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id FROM user_groups WHERE handle = ? AND synced_at > ?'
  ).get(handle, Date.now() - CACHE_TTL_MS) as { id: string } | undefined;
  return row?.id ?? null;
}

async function fetchUserGroups(client: WebClient): Promise<void> {
  const db = getDb();
  const now = Date.now();

  const result = await client.usergroups.list({ include_users: false });
  const groups = result.usergroups ?? [];

  const insert = db.prepare(
    'INSERT OR REPLACE INTO user_groups (id, handle, synced_at) VALUES (?, ?, ?)'
  );
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_groups').run();
    for (const g of groups) {
      if (g.id && g.handle) {
        insert.run(g.id, g.handle, now);
      }
    }
  });
  tx();
}

export async function resolveUserGroup(handle: string, client: WebClient): Promise<string | null> {
  const cached = lookupUserGroup(handle);
  if (cached !== null) return cached;

  if (!isTableSynced('user_groups')) {
    return syncIfNeeded('user_groups', () => lookupUserGroup(handle), () => fetchUserGroups(client));
  }

  return null;
}
