/**
 * Add the seeded test users, from the command line.
 *
 * Run by Tellop's smoke harness and by the publish security gate's probes
 * before they crawl the app. Deliberately not run automatically at boot: an app
 * that manufactures fake records every time it starts is one that eventually
 * ships them.
 *
 *   node scripts/seed-test-users.mjs
 */

import process from 'node:process';

import { closeStorage } from '../lib/data/index.js';
import { seedTestUsers, TEST_USERS } from '../lib/data/test-users.js';

const allowOnLiveApp = process.env.APP_ALLOW_SAMPLE_DATA === '1';

try {
  const result = await seedTestUsers({ allowOnLiveApp });
  process.stdout.write(
    `Sample accounts ready: ${result.users.join(', ')} (${String(result.notesAdded)} note(s) added, ${String(TEST_USERS.length)} account(s) total).\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeStorage();
}
