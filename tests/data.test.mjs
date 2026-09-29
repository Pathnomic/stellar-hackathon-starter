/**
 * What this app stores, checked against a throwaway store.
 *
 * `APP_DATA_FILE` is the one thing that decides where this app keeps what
 * people save into it (`lib/data/index.js`), so pointing it at a temporary
 * folder is how a check runs against a real store without touching the one a
 * person is using. The folder is removed again afterwards.
 *
 * The two seeded people are a contract rather than a convenience: Tellop's own
 * harnesses and the publish security probes look for exactly these two
 * identities and their notes (`lib/data/test-users.js`). So they are checked
 * here by name, and the rule underneath them - that a read always names whose
 * information it is reading - is checked by asking one person for the other
 * person's notes and getting nothing.
 *
 * Nothing here reaches the network, and no extra package is needed: the checks
 * run on what Node itself provides.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, before, test } from 'node:test';

/*
 * The store and the steps that build its shape are both found relative to the
 * folder the app is started from, so this check states that folder rather than
 * inheriting whatever one it happened to be run from.
 */
const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'app-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, MAX_NOTE_LENGTH, addNoteFor, closeStorage, findPerson, listNotesFor, modelAction, modelBatch, removeNoteFor, savePerson } =
  await import('../lib/data/index.js');
const { PRIMARY_TEST_USER, TEST_USERS, seedTestUsers } = await import('../lib/data/test-users.js');

const [personA, personB] = TEST_USERS;

before(async () => {
  await seedTestUsers();
});

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

test('the two sample people are the ones everything else looks for', () => {
  assert.equal(TEST_USERS.length, 2);
  assert.equal(PRIMARY_TEST_USER, personA);
  assert.deepEqual(
    TEST_USERS.map((user) => user.id),
    ['test-user-a', 'test-user-b'],
  );
  for (const user of TEST_USERS) {
    assert.equal(Object.isFrozen(user), true, user.id);
    assert.ok(user.notes.length > 0, `${user.id} has nothing saved against it`);
  }
});

test('the sample people are saved, marked as samples, and saved only once', async () => {
  for (const user of TEST_USERS) {
    const found = await findPerson(user.id);
    assert.equal(found?.name, user.name);
    assert.equal(found?.isSample, true, `${user.id} is not marked as a sample`);
  }
  // Running it again is safe: nothing new is added on top of what is there.
  const again = await seedTestUsers();
  assert.equal(again.notesAdded, 0);
  assert.deepEqual(
    (await listNotesFor(personA.id)).map((note) => note.body).sort(),
    [...personA.notes].sort(),
  );
});

test('a read only ever answers with one person’s own notes', async () => {
  const mine = await listNotesFor(personA.id);
  const theirs = await listNotesFor(personB.id);
  assert.ok(mine.length > 0);
  assert.ok(theirs.length > 0);
  for (const note of mine) assert.equal(note.ownerId, personA.id);
  const bodies = new Set(mine.map((note) => note.body));
  for (const note of theirs) assert.equal(bodies.has(note.body), false, note.body);
});

test('a note is saved against its owner and comes back newest first', async () => {
  const owner = 'checks-owner';
  await savePerson({ id: owner, name: 'Someone' });
  await addNoteFor(owner, 'first thing');
  await addNoteFor(owner, 'second thing');
  const saved = await listNotesFor(owner);
  assert.deepEqual(
    saved.map((note) => note.body),
    ['second thing', 'first thing'],
  );
  assert.equal(typeof saved[0]?.createdAt, 'string');
});

test('exported model actions and atomic batches use the direct client', async () => {
  const values = await modelBatch([
    { model: 'Person', action: 'create', args: { data: { id: 'batch-owner', name: 'Batch owner' } } },
    { model: 'Note', action: 'create', args: { data: { ownerId: 'batch-owner', body: 'from batch', createdAt: 'now' } } },
  ]);
  assert.equal(values[1].body, 'from batch');
  const owner = await modelAction('Person', 'findUnique', { where: { id: 'batch-owner' }, include: { notes: true } });
  assert.equal(owner.notes[0].body, 'from batch');
});

test('contained model actions distinguish an unconfirmed save from a refusal', async () => {
  const key = Symbol.for('tellop.internalRecordsAction');
  const prior = process.env.TELLOP_INTERNAL_RECORDS;
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  try {
    globalThis[key] = async () => { throw new Error('records-delivery-uncertain'); };
    await assert.rejects(() => modelAction('Person', 'create', { data: { id: 'unconfirmed', name: 'Maybe' } }),
      error => error instanceof DataError && error.messageKey === 'error.saveUnconfirmed');
    globalThis[key] = async () => { throw new Error('records-refused'); };
    await assert.rejects(() => modelBatch([{ model: 'Person', action: 'create', args: { data: { id: 'refused', name: 'No' } } }]),
      error => error instanceof DataError && error.messageKey === 'error.saveFailed');
    await assert.rejects(() => modelAction('Person', 'findMany', {}),
      error => error instanceof DataError && error.messageKey === 'error.storageUnreadable');
  } finally {
    delete globalThis[key];
    if (prior === undefined) delete process.env.TELLOP_INTERNAL_RECORDS;
    else process.env.TELLOP_INTERNAL_RECORDS = prior;
  }
});

test('a note nobody owns, or nobody wrote, is refused in words a person can read', async () => {
  await assert.rejects(() => listNotesFor('   '), (error) => {
    assert.equal(error instanceof DataError, true);
    assert.equal(error.messageKey, 'error.ownerMissing');
    return true;
  });
  await assert.rejects(() => addNoteFor(personA.id, '   '), (error) => {
    assert.equal(error.messageKey, 'error.textMissing');
    return true;
  });
  await assert.rejects(() => addNoteFor(personA.id, 'x'.repeat(MAX_NOTE_LENGTH + 1)), (error) => {
    assert.equal(error.messageKey, 'error.textTooLong');
    return true;
  });
  await assert.rejects(() => addNoteFor('nobody-at-all', 'a note'), (error) => {
    assert.equal(error.messageKey, 'error.notFound');
    return true;
  });
});

test('one person cannot remove another person’s note', async () => {
  const target = (await listNotesFor(personB.id))[0];
  assert.ok(target !== undefined);
  assert.equal(await removeNoteFor(personA.id, target.id), false);
  // Counted off the contract above rather than written out, so a second note
  // added to the sample people does not fail this for a reason of its own.
  assert.equal((await listNotesFor(personB.id)).length, personB.notes.length);
  assert.equal(await removeNoteFor(personB.id, target.id), true);
  assert.equal((await listNotesFor(personB.id)).length, personB.notes.length - 1);
});

test('sample information is refused on an app that says it is live', async () => {
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(() => seedTestUsers(), /Refusing to add sample information/);
    const forced = await seedTestUsers({ allowOnLiveApp: true });
    assert.deepEqual(forced.users, [personA.id, personB.id]);
  } finally {
    if (was === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = was;
  }
});
