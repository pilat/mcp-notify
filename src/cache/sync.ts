import { getDb } from './db.js';
import { SlackMcpError, ErrorCode } from '../utils/errors.js';

const SYNC_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTableSynced(tableName: string): boolean {
  const db = getDb();
  const meta = db.prepare(
    'SELECT completed_at FROM sync_meta WHERE table_name = ?'
  ).get(tableName) as { completed_at: number } | undefined;
  return (meta?.completed_at ?? 0) > Date.now() - CACHE_TTL_MS;
}

/**
 * Generic check-lock-recheck sync coordinator.
 *
 * 1. lookupFn() — if found, return immediately
 * 2. Check sync_meta — if another instance is syncing, poll until done
 * 3. Claim sync atomically (CAS) — set started_at only if no one else is syncing
 * 4. Call apiFetchFn() — fetch data from Slack API
 * 5. Write results — apiFetchFn handles the DB writes
 * 6. Mark completed — set completed_at (only on success)
 * 7. lookupFn() — return final result
 */
export async function syncIfNeeded<T>(
  tableName: string,
  lookupFn: () => T | null,
  apiFetchFn: () => Promise<void>,
): Promise<T | null> {
  // Step 1: check cache
  const cached = lookupFn();
  if (cached !== null) return cached;

  const db = getDb();
  const now = Date.now();

  // Step 2: check if another instance is syncing
  const meta = db.prepare(
    'SELECT started_at, completed_at FROM sync_meta WHERE table_name = ?'
  ).get(tableName) as { started_at: number; completed_at: number } | undefined;

  if (meta && meta.started_at > meta.completed_at) {
    const elapsed = now - meta.started_at;
    if (elapsed < SYNC_TIMEOUT_MS) {
      // Another instance is syncing — poll
      const deadline = meta.started_at + SYNC_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const result = lookupFn();
        if (result !== null) return result;

        const updated = db.prepare(
          'SELECT completed_at FROM sync_meta WHERE table_name = ?'
        ).get(tableName) as { completed_at: number } | undefined;
        if (updated && updated.completed_at >= meta.started_at) {
          break;
        }
      }
      const afterWait = lookupFn();
      if (afterWait !== null) return afterWait;
    }
  }

  // Step 3: CAS claim — atomic check-and-set, also claims stale locks
  const claimTime = Date.now();
  const claimed = db.prepare(
    `UPDATE sync_meta SET started_at = ?
     WHERE table_name = ? AND (completed_at >= started_at OR started_at + ? < ?)`
  ).run(claimTime, tableName, SYNC_TIMEOUT_MS, claimTime);

  if (claimed.changes === 0) {
    // Someone else just claimed it — poll and return
    const deadline = claimTime + SYNC_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const result = lookupFn();
      if (result !== null) return result;

      const updated = db.prepare(
        'SELECT completed_at FROM sync_meta WHERE table_name = ?'
      ).get(tableName) as { completed_at: number } | undefined;
      if (updated && updated.completed_at >= claimTime) {
        break;
      }
    }
    return lookupFn();
  }

  // Step 4-5: fetch and write
  try {
    await apiFetchFn();
    // Step 6: mark completed only on success
    db.prepare(
      'UPDATE sync_meta SET completed_at = ? WHERE table_name = ?'
    ).run(Date.now(), tableName);
  } catch (err: unknown) {
    // Reset lock to allow immediate retry
    db.prepare(
      'UPDATE sync_meta SET started_at = completed_at WHERE table_name = ?'
    ).run(tableName);
    const msg = err instanceof Error ? err.message : String(err);
    throw new SlackMcpError(ErrorCode.SYNC_FAILED, `Failed to sync ${tableName}: ${msg}`);
  }

  // Step 7: final lookup
  return lookupFn();
}
