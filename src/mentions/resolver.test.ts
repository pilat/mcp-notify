import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebClient } from '@slack/web-api';

vi.mock('../cache/users.js', () => ({
  resolveUserGroup: vi.fn(),
  resolveUser: vi.fn(),
}));

import { convertMentions } from './resolver.js';
import { resolveUserGroup, resolveUser } from '../cache/users.js';

const mockResolveUserGroup = vi.mocked(resolveUserGroup);
const mockResolveUser = vi.mocked(resolveUser);

const fakeClient = {} as WebClient;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('convertMentions', () => {
  it('returns message as-is when no @ symbols present', async () => {
    const result = await convertMentions('hello world', fakeClient);
    expect(result).toBe('hello world');
    expect(mockResolveUserGroup).not.toHaveBeenCalled();
    expect(mockResolveUser).not.toHaveBeenCalled();
  });

  it('returns message as-is when @ is in email-like context', async () => {
    // email has a word char before @, so regex (?<!\w)@ won't match
    const result = await convertMentions('email user@example.com', fakeClient);
    expect(result).toBe('email user@example.com');
  });

  it('resolves a single user mention', async () => {
    mockResolveUserGroup.mockResolvedValue(null);
    mockResolveUser.mockResolvedValue('U12345');

    const result = await convertMentions('hey @john check this', fakeClient);

    expect(result).toBe('hey <@U12345> check this');
    expect(mockResolveUserGroup).toHaveBeenCalledWith('john', fakeClient);
    expect(mockResolveUser).toHaveBeenCalledWith('john', fakeClient);
  });

  it('resolves a user group mention (groups take priority)', async () => {
    mockResolveUserGroup.mockResolvedValue('S98765');

    const result = await convertMentions('hey @backend-team check this', fakeClient);

    expect(result).toBe('hey <!subteam^S98765> check this');
    expect(mockResolveUserGroup).toHaveBeenCalledWith('backend-team', fakeClient);
    // User lookup should NOT be called when group is found
    expect(mockResolveUser).not.toHaveBeenCalled();
  });

  it('leaves unknown mentions as-is', async () => {
    mockResolveUserGroup.mockResolvedValue(null);
    mockResolveUser.mockResolvedValue(null);

    const result = await convertMentions('hey @unknown-person', fakeClient);

    expect(result).toBe('hey @unknown-person');
  });

  it('resolves multiple different mentions', async () => {
    mockResolveUserGroup.mockImplementation(async (name) => {
      if (name === 'team-a') return 'S111';
      return null;
    });
    mockResolveUser.mockImplementation(async (name) => {
      if (name === 'alice') return 'U222';
      return null;
    });

    const result = await convertMentions('@team-a please review, cc @alice and @nobody', fakeClient);

    expect(result).toBe('<!subteam^S111> please review, cc <@U222> and @nobody');
  });

  it('resolves duplicate mentions only once', async () => {
    mockResolveUserGroup.mockResolvedValue(null);
    mockResolveUser.mockResolvedValue('U999');

    const result = await convertMentions('@bob and @bob again', fakeClient);

    expect(result).toBe('<@U999> and <@U999> again');
    // Should only resolve once despite two occurrences
    expect(mockResolveUserGroup).toHaveBeenCalledTimes(1);
    expect(mockResolveUser).toHaveBeenCalledTimes(1);
  });

  it('handles mention at start of message', async () => {
    mockResolveUserGroup.mockResolvedValue(null);
    mockResolveUser.mockResolvedValue('U100');

    const result = await convertMentions('@admin hello', fakeClient);
    expect(result).toBe('<@U100> hello');
  });

  it('handles mention at end of message', async () => {
    mockResolveUserGroup.mockResolvedValue(null);
    mockResolveUser.mockResolvedValue('U100');

    const result = await convertMentions('hello @admin', fakeClient);
    expect(result).toBe('hello <@U100>');
  });

  it('handles mentions with dots in names', async () => {
    mockResolveUserGroup.mockResolvedValue(null);
    mockResolveUser.mockResolvedValue('U300');

    const result = await convertMentions('hey @john.doe', fakeClient);
    expect(result).toBe('hey <@U300>');
    expect(mockResolveUser).toHaveBeenCalledWith('john.doe', fakeClient);
  });

  it('handles @ followed by non-word characters (no match)', async () => {
    const result = await convertMentions('hello @ world', fakeClient);
    expect(result).toBe('hello @ world');
  });

  it('does not match @ inside a word', async () => {
    // The lookbehind (?<!\w) prevents matching @ after a word char
    const result = await convertMentions('test word@mention', fakeClient);
    expect(result).toBe('test word@mention');
  });

  describe('broadcast mentions', () => {
    it('resolves @here to <!here>', async () => {
      const result = await convertMentions('hey @here look at this', fakeClient);
      expect(result).toBe('hey <!here> look at this');
      expect(mockResolveUserGroup).not.toHaveBeenCalled();
      expect(mockResolveUser).not.toHaveBeenCalled();
    });

    it('resolves @channel to <!channel>', async () => {
      const result = await convertMentions('@channel important update', fakeClient);
      expect(result).toBe('<!channel> important update');
    });

    it('resolves @everyone to <!everyone>', async () => {
      const result = await convertMentions('hello @everyone', fakeClient);
      expect(result).toBe('hello <!everyone>');
    });

    it('resolves broadcast mentions alongside regular mentions', async () => {
      mockResolveUserGroup.mockResolvedValue(null);
      mockResolveUser.mockImplementation(async (name) => {
        if (name === 'alice') return 'U222';
        return null;
      });

      const result = await convertMentions('@here @alice please check', fakeClient);
      expect(result).toBe('<!here> <@U222> please check');
    });
  });
});
