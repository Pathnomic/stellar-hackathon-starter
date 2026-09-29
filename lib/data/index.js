/**
 * The one place in this app that talks to stored information.
 *
 * Nothing outside `lib/data/` may import `node:sqlite`, reach the generated
 * client, or contain a raw statement - `AGENTS.md` rule 1 states it and Tellop's
 * template conformance suite fails when it is broken. Two reasons, and neither is
 * style:
 *
 *  - **Injection is excluded structurally, not by review.** Every read and write
 *    below goes through the generated client, which builds its own statements
 *    from named fields. Feature code cannot build one because feature code has no
 *    way to reach the storage handle.
 *  - **How this app keeps information is a described shape** (`prisma/schema.prisma`),
 *    and changing it is a reviewed, rehearsed step in `prisma/migrations/` rather
 *    than an edit to this file. That is what lets Tellop rehearse a change on a
 *    copy before it touches anything real.
 *
 * The other rule the shape encodes: **a read always names whose information it
 * is reading.** There is no `listAllNotes`. That is what makes the cross-user
 * access probes in the publish security gate meaningful rather than decorative.
 *
 * ## Every read and write here is awaited
 *
 * These used to answer immediately. They now return a promise, because the layer
 * underneath does - and a synchronous wrapper around it would be a wrapper that
 * either blocks the whole app or lies about when the save happened.
 *
 * ## This app sets itself up, with no tooling present
 *
 * An exported project has no Tellop and no toolchain. So the steps in
 * `prisma/migrations/` are applied *here*, once, when the store is first opened,
 * and the store records that they were applied in the same place the toolchain
 * looks - so a project Tellop later changes is a project the toolchain already
 * understands. See `applyStepsOnce`.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { prepareConnection, StorageAdapterFactory } from './adapter/index.js';
import { PrismaClient } from './generated/client.ts';

/** Longest note this app accepts, in characters. */
export const MAX_NOTE_LENGTH = 500;

/**
 * A refusal a person can be shown. `messageKey` indexes `lib/i18n/locales`, so
 * the words are translated where they are displayed and never assembled here.
 */
export class DataError extends Error {
  /** @param {string} messageKey */
  constructor(messageKey) {
    super(messageKey);
    this.name = 'DataError';
    /** @type {string} */
    this.messageKey = messageKey;
  }
}

/**
 * Where this app keeps what people save into it.
 *
 * Defaults inside the project so a freshly created app works with no setup.
 * `APP_DATA_FILE` overrides it - Tellop points that at the per-project location
 * when it starts the app. It holds a path and never a private value.
 */
function storageFile() {
  const configured = process.env.APP_DATA_FILE;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return path.join(process.cwd(), '.data', 'app.db');
}

/** Where the steps that build this app's shape are kept. */
function stepsDirectory() {
  return path.join(process.cwd(), 'prisma', 'migrations');
}

/**
 * Every step this app ships, in the order they must run.
 *
 * Folder names begin with the moment they were made, so sorting them by name
 * sorts them by time - which is the same order the toolchain replays them in.
 * The digest is the toolchain's own: the same bytes hashed the same way, so a
 * store this app sets up is a store the toolchain reads as already set up.
 */
function shippedSteps() {
  const directory = stepsDirectory();
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const body = readFileSync(path.join(directory, name, 'migration.sql'), 'utf8');
      return { name, body, digest: createHash('sha256').update(body).digest('hex') };
    });
}

const APPLIED_RECORD = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id"                    TEXT PRIMARY KEY NOT NULL,
      "checksum"              TEXT NOT NULL,
      "finished_at"           DATETIME,
      "migration_name"        TEXT NOT NULL,
      "logs"                  TEXT,
      "rolled_back_at"        DATETIME,
      "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
  )
`;

/**
 * Set this app up, exactly once, on a store that has never been set up.
 *
 * Three things here are load-bearing.
 *
 *  - **The whole set-up is one group of changes.** Node's storage carries the
 *    counter this reads (`user_version`) inside the same group as the shape
 *    changes, so a set-up interrupted half way leaves a store that has *nothing*
 *    - never one that looks finished. A half-built store that reads as finished
 *    is the failure this design exists to make impossible.
 *  - **A store the toolchain already manages is left completely alone.** Its own
 *    record is the signal, and it is the toolchain's to write from then on.
 *  - **The counter is compared, never trusted as text.** It is written into the
 *    statement because that setting takes no values, so it is checked as a whole
 *    number in range first; every other value here is bound, not written in.
 */
function applyStepsOnce(handle) {
  const managed = handle
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'")
    .get();
  if (managed !== undefined) return;

  const marker = Number(handle.prepare('PRAGMA user_version').get().user_version);
  if (!Number.isInteger(marker) || marker < 0) throw new DataError('error.storageUnreadable');
  if (marker !== 0) throw new DataError('error.storageUnreadable');

  const steps = shippedSteps();
  if (steps.length === 0) return;
  if (!Number.isSafeInteger(steps.length)) throw new DataError('error.storageUnreadable');

  handle.exec('BEGIN IMMEDIATE');
  try {
    for (const step of steps) handle.exec(step.body);
    handle.exec(APPLIED_RECORD);
    const record = handle.prepare(
      `INSERT INTO "_prisma_migrations"
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
    );
    const at = Date.now();
    for (const step of steps) record.run(randomUUID(), step.digest, at, step.name, at);
    handle.exec(`PRAGMA user_version = ${String(steps.length)}`);
    handle.exec('COMMIT');
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
}

/**
 * One handle per process, kept on `globalThis`.
 *
 * The development server reloads this module on every edit; a fresh handle per
 * reload leaks file descriptors until the app stops answering. The symbol is
 * registered rather than local for the same reason.
 */
const HANDLE = Symbol.for('tellop.template.storage');
const INTERNAL_READ = Symbol.for('tellop.internalRecordsRead');
const INTERNAL_WRITE = Symbol.for('tellop.internalRecordsWrite');
const INTERNAL_ACTION = Symbol.for('tellop.internalRecordsAction');
const INTERNAL_TRANSACTION = Symbol.for('tellop.internalRecordsTransaction');
const MODEL_WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany',
  'updateManyAndReturn', 'upsert', 'delete', 'deleteMany']);
function internalRecords() { return process.env.TELLOP_INTERNAL_RECORDS === '1'; }
async function internalActions(steps) {
  const call = globalThis[INTERNAL_ACTION];
  if (typeof call !== 'function') throw new DataError('error.storageUnreadable');
  try { return await call(steps); }
  catch (error) {
    const writes = steps.some(step => MODEL_WRITES.has(step.action));
    if (writes && error instanceof Error && error.message === 'records-delivery-uncertain')
      throw new DataError('error.saveUnconfirmed');
    throw new DataError(writes ? 'error.saveFailed' : 'error.storageUnreadable');
  }
}
function internalWrite() {
  const write = globalThis[INTERNAL_WRITE];
  if (typeof write !== 'function') throw new DataError('error.storageUnreadable');
  return write;
}
function writeFailure(error) {
  if (error instanceof Error && error.message === 'records-delivery-uncertain') throw new DataError('error.saveUnconfirmed');
  throw new DataError('error.saveFailed');
}

function open() {
  const file = storageFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);
  prepareConnection(handle);
  applyStepsOnce(handle);
  const client = new PrismaClient({ adapter: new StorageAdapterFactory(handle) });
  return { handle, client };
}

function opened() {
  const cached = globalThis[HANDLE];
  if (cached !== undefined) return cached;
  const fresh = open();
  globalThis[HANDLE] = fresh;
  return fresh;
}

/** @returns {import('./generated/client.ts').PrismaClient} */
function records() {
  // Existing helpers keep their generated-client model/action call shape. The
  // contained variant resolves each call through the selected Main schema and
  // store; it never opens a local handle or imports app-supplied storage code.
  if (internalRecords()) {
    return new Proxy(Object.create(null), { get(_target, model) {
      if (typeof model !== 'string' || model === 'then') return undefined;
      if (model === '$transaction') {
        const callback = globalThis[INTERNAL_TRANSACTION];
        if (typeof callback !== 'function') throw new DataError('error.storageUnreadable');
        return async (work, options) => {
          try { return await callback(work, options); }
          catch (error) {
            if (error instanceof Error && error.message === 'records-delivery-uncertain')
              throw new DataError('error.saveUnconfirmed');
            throw error;
          }
        };
      }
      if (model.startsWith('$')) return undefined;
      return new Proxy(Object.create(null), { get(_delegate, action) {
        if (typeof action !== 'string' || action === 'then') return undefined;
        return async args => (await internalActions([{ model: model[0].toUpperCase() + model.slice(1), action, args: args ?? {} }]))[0];
      } });
    } });
  }
  if (globalThis[INTERNAL_READ] !== undefined) throw new DataError('error.storageUnreadable');
  return opened().client;
}

/** The selected app's model route. A contained app supplies only a model name,
 * named action and arguments; Tellop resolves the selected schema and store.
 * Exported apps continue to use their own generated client directly. */
export async function modelAction(model, action, args = {}) {
  if (internalRecords()) {
    return (await internalActions([{ model, action, args }]))[0];
  }
  const delegate = records()[model[0].toLowerCase() + model.slice(1)];
  if (delegate === undefined || typeof delegate[action] !== 'function') throw new DataError('error.storageUnreadable');
  return await delegate[action](args);
}

/** An atomic, finite group of named model actions. All results arrive only
 * after settlement; a missing reply is never resubmitted automatically. */
export async function modelBatch(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 32) throw new DataError('error.storageUnreadable');
  if (internalRecords()) {
    return await internalActions(steps);
  }
  return await records().$transaction(async transaction => {
    const values = [];
    for (const step of steps) {
      const delegate = transaction[step.model[0].toLowerCase() + step.model.slice(1)];
      if (delegate === undefined || typeof delegate[step.action] !== 'function') throw new DataError('error.storageUnreadable');
      values.push(await delegate[step.action](step.args ?? {}));
    }
    return values;
  });
}

/**
 * Close the handle. Only Tellop's own harnesses call this; the app never does.
 *
 * @returns {Promise<void>}
 */
export async function closeStorage() {
  const cached = globalThis[HANDLE];
  if (cached === undefined) return;
  globalThis[HANDLE] = undefined;
  await cached.client.$disconnect().catch(() => undefined);
  cached.handle.close();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function requireOwner(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DataError('error.ownerMissing');
  }
  return value.trim();
}

/** @typedef {{ id: string, name: string, isSample: boolean }} Person */
/** @typedef {{ id: number, ownerId: string, body: string, createdAt: string }} Note */

/**
 * Add or update a person. Used by the sample-information hook and by whatever
 * sign-in recipe a project grows later.
 *
 * @param {{ id: string, name: string, isSample?: boolean }} person
 * @returns {Promise<Person>}
 */
export async function savePerson(person) {
  const id = requireOwner(person.id);
  const name = typeof person.name === 'string' ? person.name.trim() : '';
  if (name.length === 0) throw new DataError('error.textMissing');
  const isSample = person.isSample === true;
  await records().person.upsert({
    where: { id },
    update: { name, isSample },
    create: { id, name, isSample },
  });
  return { id, name, isSample };
}

/**
 * @param {unknown} id
 * @returns {Promise<Person | undefined>}
 */
export async function findPerson(id) {
  const owner = requireOwner(id);
  const found = await records().person.findUnique({ where: { id: owner } });
  if (found === null) return undefined;
  return { id: found.id, name: found.name, isSample: found.isSample === true };
}

/**
 * Notes belonging to one person, newest first.
 *
 * The owner is required and there is no way to ask for everyone's. Keep it that
 * way: this signature is what the cross-user access probe relies on.
 *
 * @param {unknown} ownerId
 * @returns {Promise<Note[]>}
 */
export async function listNotesFor(ownerId) {
  const owner = requireOwner(ownerId);
  const found = await records().note.findMany({
    where: { ownerId: owner },
    orderBy: { id: 'desc' },
  });
  return found.map((note) => ({
    id: Number(note.id),
    ownerId: String(note.ownerId),
    body: String(note.body),
    createdAt: String(note.createdAt),
  }));
}

/** One bounded page. `nextCursor` names the last note in this page, or null.
 * The internal preview delegates only this read to Tellop; exported apps keep
 * their direct generated client and store initialization. */
export async function listNotesPageFor(ownerId, cursor = null) {
  const owner = requireOwner(ownerId);
  if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1)) throw new DataError('error.notFound');
  const read = globalThis[INTERNAL_READ];
  if (internalRecords() || read !== undefined) {
    if (typeof read !== 'function') throw new DataError('error.storageUnreadable');
    const result = await read(owner, cursor);
    if (!Array.isArray(result?.notes) || (result.nextCursor !== null && !Number.isSafeInteger(result.nextCursor)))
      throw new DataError('error.storageUnreadable');
    return result;
  }
  const found = await records().note.findMany({
    where: { ownerId: owner }, orderBy: { id: 'desc' }, take: 26,
    ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: { id: true, ownerId: true, body: true, createdAt: true },
  });
  const notes = found.slice(0, 25).map(note => ({ id: Number(note.id), ownerId: String(note.ownerId),
    body: String(note.body), createdAt: String(note.createdAt) }));
  return { notes, nextCursor: found.length > 25 ? notes.at(-1).id : null };
}

/**
 * @param {unknown} ownerId
 * @param {unknown} body
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<Note>}
 */
export async function addNoteFor(ownerId, body, options = {}) {
  const owner = requireOwner(ownerId);
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new DataError('error.textMissing');
  }
  const text = body.trim();
  if (text.length > MAX_NOTE_LENGTH) throw new DataError('error.textTooLong');
  if (internalRecords()) {
    try {
      const result = await internalWrite()('notes-create', { owner, text });
      if (!result?.note || result.note.ownerId !== owner || result.note.body !== text) throw new Error('records-result-refused');
      return result.note;
    } catch (error) { writeFailure(error); }
  }
  if ((await findPerson(owner)) === undefined) throw new DataError('error.notFound');
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const created = await records().note.create({
    data: { ownerId: owner, body: text, createdAt },
  });
  return { id: Number(created.id), ownerId: owner, body: text, createdAt };
}

/**
 * Remove one note, but only if it belongs to the person asking.
 *
 * The ownership condition is part of the request rather than a check before it: a
 * read-then-remove can be raced, and this cannot.
 *
 * @param {unknown} ownerId
 * @param {unknown} noteId
 * @returns {Promise<boolean>} whether anything was removed
 */
export async function removeNoteFor(ownerId, noteId) {
  const owner = requireOwner(ownerId);
  const id = Number(noteId);
  if (!Number.isInteger(id)) throw new DataError('error.notFound');
  if (internalRecords()) {
    try {
      const result = await internalWrite()('notes-delete', { owner, id });
      if (typeof result?.removed !== 'boolean') throw new Error('records-result-refused');
      return result.removed;
    } catch (error) { writeFailure(error); }
  }
  const removed = await records().note.deleteMany({ where: { id, ownerId: owner } });
  return Number(removed.count) > 0;
}
