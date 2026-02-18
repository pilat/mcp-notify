import type { WebClient } from '@slack/web-api';
import { resolveUserGroup, resolveUser } from '../cache/users.js';

/**
 * Convert @mentions in message text to Slack format.
 *
 * - @grouphandle → <!subteam^ID>  (groups take priority)
 * - @username → <@ID>
 * - Unknown mentions are left as-is.
 */
export async function convertMentions(message: string, client: WebClient): Promise<string> {
  if (!message.includes('@')) return message;

  const regex = /(?<!\w)@([\w.-]+\w)/g;
  const names = new Set<string>();
  let match;
  while ((match = regex.exec(message)) !== null) {
    if (match[1]) names.add(match[1]);
  }

  if (names.size === 0) return message;

  // Resolve all mentions in parallel
  const entries = await Promise.all(
    [...names].map(async (name): Promise<[string, string | null]> => {
      const groupId = await resolveUserGroup(name, client);
      if (groupId) return [name, `<!subteam^${groupId}>`];

      const userId = await resolveUser(name, client);
      if (userId) return [name, `<@${userId}>`];

      return [name, null];
    })
  );

  const replacements = new Map<string, string>();
  for (const [name, replacement] of entries) {
    if (replacement) replacements.set(name, replacement);
  }

  if (replacements.size === 0) return message;

  return message.replace(/(?<!\w)@([\w.-]+\w)/g, (full, name: string) => {
    return replacements.get(name) ?? full;
  });
}
