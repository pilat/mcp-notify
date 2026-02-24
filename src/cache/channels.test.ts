import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebClient } from '@slack/web-api';

vi.mock('./db.js', () => ({
  getDb: vi.fn(),
}));

vi.mock('./sync.js', () => ({
  syncIfNeeded: vi.fn(),
  CACHE_TTL_MS: 86400000,
}));

import { getChannelId } from './channels.js';
import { getDb } from './db.js';
import { syncIfNeeded } from './sync.js';

const mockGetDb = vi.mocked(getDb);
const mockSyncIfNeeded = vi.mocked(syncIfNeeded);

function createMockDb(rows: { id: string; name: string }[]): unknown {
  return {
    prepare: vi.fn((sql: string) => ({
      get: vi.fn((...args: unknown[]) => {
        if (sql.includes('WHERE name = ?')) {
          const name = args[0] as string;
          const row = rows.find((r) => r.name === name);
          return row ? { id: row.id } : undefined;
        }
        if (sql.includes('WHERE id = ?')) {
          const id = args[0] as string;
          const row = rows.find((r) => r.id === id);
          return row ? { id: row.id } : undefined;
        }
        return undefined;
      }),
    })),
  };
}

const mockClient = {} as WebClient;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('getChannelId', () => {
  it('returns cached channel by name — no sync triggered', async () => {
    mockGetDb.mockReturnValue(createMockDb([{ id: 'C111', name: 'general' }]) as ReturnType<typeof getDb>);

    const result = await getChannelId('general', mockClient);

    expect(result).toBe('C111');
    expect(mockSyncIfNeeded).not.toHaveBeenCalled();
  });

  it('returns cached channel by ID when name lookup misses', async () => {
    mockGetDb.mockReturnValue(createMockDb([{ id: 'C222', name: 'random' }]) as ReturnType<typeof getDb>);

    const result = await getChannelId('C222', mockClient);

    expect(result).toBe('C222');
    expect(mockSyncIfNeeded).not.toHaveBeenCalled();
  });

  it('triggers sync when both name and ID miss, sync finds by name', async () => {
    mockGetDb.mockReturnValue(createMockDb([]) as ReturnType<typeof getDb>);
    mockSyncIfNeeded.mockResolvedValue('C333');

    const result = await getChannelId('new-channel', mockClient);

    expect(result).toBe('C333');
    expect(mockSyncIfNeeded).toHaveBeenCalledTimes(1);
    expect(mockSyncIfNeeded).toHaveBeenCalledWith(
      'channels',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('triggers sync when both lookups miss, sync finds by ID', async () => {
    mockGetDb.mockReturnValue(createMockDb([]) as ReturnType<typeof getDb>);
    mockSyncIfNeeded.mockResolvedValue('C444');

    const result = await getChannelId('C444', mockClient);

    expect(result).toBe('C444');
    expect(mockSyncIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('returns null when everything misses', async () => {
    mockGetDb.mockReturnValue(createMockDb([]) as ReturnType<typeof getDb>);
    mockSyncIfNeeded.mockResolvedValue(null);

    const result = await getChannelId('nonexistent', mockClient);

    expect(result).toBeNull();
    expect(mockSyncIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('passes a combined lookup function to syncIfNeeded', async () => {
    // After sync, the DB will have the channel — simulate by switching mock mid-call
    const dbWithChannel = createMockDb([{ id: 'C555', name: 'late-channel' }]);
    const emptyDb = createMockDb([]);
    mockGetDb.mockReturnValue(emptyDb as ReturnType<typeof getDb>);

    // Capture the lookupFn passed to syncIfNeeded and call it with the populated DB
    mockSyncIfNeeded.mockImplementation(async (_table, lookupFn) => {
      // Switch to populated DB to simulate post-sync state
      mockGetDb.mockReturnValue(dbWithChannel as ReturnType<typeof getDb>);
      return (lookupFn as () => string | null)();
    });

    const result = await getChannelId('late-channel', mockClient);

    expect(result).toBe('C555');
  });

  it('combined lookup finds by ID when name misses', async () => {
    const dbWithChannel = createMockDb([{ id: 'C666', name: 'something-else' }]);
    const emptyDb = createMockDb([]);
    mockGetDb.mockReturnValue(emptyDb as ReturnType<typeof getDb>);

    mockSyncIfNeeded.mockImplementation(async (_table, lookupFn) => {
      mockGetDb.mockReturnValue(dbWithChannel as ReturnType<typeof getDb>);
      return (lookupFn as () => string | null)();
    });

    // Search by ID — name won't match, but ID will
    const result = await getChannelId('C666', mockClient);

    expect(result).toBe('C666');
  });
});
