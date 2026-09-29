/**
 * The seeded test users.
 *
 * Two of them, deterministic, and the count is not arbitrary: the publish
 * security gate's access-control probes crawl the app logged out (private pages
 * must refuse) and then as one user against the other's addresses (nothing
 * belonging to one may be readable by the other). That needs exactly two known
 * identities with known information attached (Tellop's security
 * baseline). Tellop's smoke and conformance checks read the same
 * constants, so **the ids and the note bodies below are a contract**: changing
 * them silently disarms every check that looks for them.
 *
 * They are seeded, never invented at runtime, and they are marked. Anything on
 * screen that came from here has to say so - `AGENTS.md` rule 4.
 */

import process from 'node:process';

import { addNoteFor, listNotesFor, savePerson } from './index.js';

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly name: string,
 *   readonly notes: readonly string[],
 * }} TestUser
 */

/**
 * Names are deliberately not sentences: they are displayed as-is in both
 * languages, and the honesty around them (`sample.badge`, `sample.notice`) is
 * what gets translated.
 *
 * @type {readonly TestUser[]}
 */
export const TEST_USERS = Object.freeze([
  Object.freeze({
    id: 'test-user-a',
    name: 'Test A',
    notes: Object.freeze(['Water the plants on Sunday.']),
  }),
  Object.freeze({
    id: 'test-user-b',
    name: 'Test B',
    notes: Object.freeze(['Call the dentist back.']),
  }),
]);

/** The identity the starting page shows. */
export const PRIMARY_TEST_USER = TEST_USERS[0];

export class SampleDataRefusedError extends Error {
  constructor() {
    super(
      'Refusing to add sample information to a live app. Sample information is for testing only.',
    );
    this.name = 'SampleDataRefusedError';
  }
}

/**
 * Add the test users and their notes. Safe to run more than once.
 *
 * Refuses on a live app unless a caller says explicitly that it means it: the
 * whole point of this data is that it is fake, and fake records mixed into real
 * ones is a trust problem no error message repairs afterwards.
 *
 * @param {{ allowOnLiveApp?: boolean }} [options]
 * @returns {Promise<{ users: string[], notesAdded: number }>}
 */
export async function seedTestUsers(options = {}) {
  const live = process.env.NODE_ENV === 'production';
  if (live && options.allowOnLiveApp !== true) throw new SampleDataRefusedError();

  /** @type {string[]} */
  const users = [];
  let notesAdded = 0;
  for (const user of TEST_USERS) {
    await savePerson({ id: user.id, name: user.name, isSample: true });
    users.push(user.id);
    const existing = new Set((await listNotesFor(user.id)).map((note) => note.body));
    for (const body of user.notes) {
      if (existing.has(body)) continue;
      await addNoteFor(user.id, body);
      notesAdded += 1;
    }
  }
  return { users, notesAdded };
}
