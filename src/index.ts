#!/usr/bin/env node

import { runServer } from './server.js';
import { closeDb } from './cache/db.js';

let server: Awaited<ReturnType<typeof runServer>> | null = null;

function shutdown(): void {
  try { server?.close(); } catch { /* ignore */ }
  try { closeDb(); } catch { /* ignore */ }
  process.exit(0);
}

async function main(): Promise<void> {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server = await runServer();
}

main().catch((error: unknown) => {
  try { closeDb(); } catch { /* ignore */ }
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
