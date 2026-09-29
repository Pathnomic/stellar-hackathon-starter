/**
 * The seam between this app's data layer and Node's own storage.
 *
 * ## Why this file is part of the app rather than a dependency
 *
 * Every published package that fills this role fails one of the rules this
 * template is qualified against: they compile native code when they install, or
 * they add a platform-specific binary, or they duplicate something Node already
 * ships. Node's storage is *in Node*, so the piece that adapts it is a hundred
 * lines of ordinary JavaScript and belongs here, where it is read and reviewed
 * with the rest of the app.
 *
 * ## What it must get right
 *
 * - **Write-ahead logging and reference checking are set here, at open.** The
 *   data layer's runtime does not set them, and without the first a read taken
 *   while a save is in flight fails outright instead of waiting.
 * - **One handle, one statement at a time.** Node's storage is synchronous and a
 *   single connection: a second thing starting a group of changes while the first
 *   is still open would interleave them. `startTransaction` therefore waits for
 *   the previous group to finish rather than opening a second one.
 * - **A refusal keeps its meaning** (`errors.js`), so "this name is already
 *   taken" survives the trip instead of arriving as "something went wrong".
 *
 * Nothing outside `lib/data/` may import this file - the same rule as the rest of
 * this directory, and for the same reason: it can reach stored information.
 */

import { DatabaseSync } from 'node:sqlite';

import { columnTypesFor, readRow, writeArgument } from './conversion.js';
import { rethrowAsStorageRefusal } from './errors.js';

/**
 * A refusal from storage, as a rejected promise.
 *
 * Every method here promises one, so a refusal must arrive as one. Throwing
 * where a promise was promised is a refusal the caller's `.catch` never sees -
 * and the one failure this file could not name escaped exactly that way, out of a
 * method whose contract said otherwise.
 */
function refusalFor(error) {
  try {
    rethrowAsStorageRefusal(error);
  } catch (refusal) {
    return Promise.reject(refusal);
  }
  return Promise.reject(error);
}

/** Named so a refusal can say which seam produced it. */
const ADAPTER_NAME = 'tellop-template-node-sqlite';

/**
 * One-at-a-time access to the single handle.
 *
 * A promise chain rather than a package: the whole mechanism is "the next waiter
 * starts when the current one releases", and a dependency for that would be a
 * dependency in every app this template creates.
 */
class Turnstile {
  #tail = Promise.resolve();

  take() {
    let release;
    const taken = new Promise((resolve) => {
      release = resolve;
    });
    const mine = this.#tail.then(() => release);
    this.#tail = this.#tail.then(() => taken);
    return mine;
  }
}

class Queryable {
  provider = 'sqlite';
  adapterName = ADAPTER_NAME;

  constructor(handle, bounds) {
    this.handle = handle;
    this.bounds = bounds;
  }

  #prepared(query) {
    const statement = this.handle.prepare(query.sql);
    const args = query.args.map((argument, index) => writeArgument(argument, query.argTypes[index]));
    return { statement, args };
  }

  queryRaw(query) {
    try {
      const { statement, args } = this.#prepared(query);
      const columns = statement.columns();
      if (columns.length === 0) {
        // Not a read. Run it anyway - the runtime sends statements here that
        // return nothing - and answer with an empty result rather than an error.
        statement.run(...args);
        return Promise.resolve({ columnNames: [], columnTypes: [], rows: [] });
      }
      statement.setReturnArrays(true);
      // Whole numbers arrive oversized so nothing is lost coming out of storage;
      // `readRow` narrows them again only where narrowing is exact.
      statement.setReadBigInts(true);
      const rows = this.bounds === undefined ? statement.all(...args) : (() => {
        const collected = [];
        let bytes = 0;
        for (const row of statement.iterate(...args)) {
          collected.push(row);
          bytes += row.reduce((total, cell) => total + (typeof cell === 'string' ? Buffer.byteLength(cell) :
            cell instanceof Uint8Array ? cell.byteLength : 16), 0);
          if (collected.length > this.bounds.rows || bytes > this.bounds.bytes)
            throw new Error('records-qualified-result-bound');
        }
        return collected;
      })();
      const columnTypes = columnTypesFor(
        columns.map((column) => column.type),
        rows,
      );
      return Promise.resolve({
        columnNames: columns.map((column) => column.name),
        columnTypes,
        rows: rows.map((row) => readRow(row, columnTypes)),
      });
    } catch (error) {
      return refusalFor(error);
    }
  }

  executeRaw(query) {
    try {
      const { statement, args } = this.#prepared(query);
      const result = statement.run(...args);
      return Promise.resolve(Number(result.changes));
    } catch (error) {
      return refusalFor(error);
    }
  }
}

/**
 * A savepoint name Node's storage will accept as a plain name.
 *
 * The one place in this file where a value is written into a statement rather
 * than bound, because a savepoint name cannot be a bound value. The name comes
 * from the data layer's own runtime rather than from anything a person or a page
 * typed, so this is a belt: everything else here binds, and the one thing that
 * cannot bind is checked instead of trusted.
 */
const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function requirePlainName(name) {
  if (typeof name !== 'string' || !PLAIN_NAME.test(name)) {
    throw new TypeError('that is not a name this app will put into a statement');
  }
  return name;
}

class Group extends Queryable {
  /**
   * **This app's storage opens and closes a group of changes itself.**
   *
   * `usePhantomQuery: true` says so, and it has to be true here because this app
   * keeps ONE connection: whoever opens a group must be the one that closes it,
   * or a group left open sits on the only connection there is and every later
   * save fails.
   *
   * It was `false`, which tells the runtime to send the closing statement itself
   * as an ordinary one - and this file *also* sent its own. Measured against the
   * pinned client: the second close failed, and because a failure it could not
   * name escaped unwrapped, an ordinary multi-row save reported "cannot commit"
   * to the person **while having saved every row**, a nested save reported a
   * different failure with both rows written, and two saves at once brought the
   * whole app down. An app that writes a person's information and tells them it
   * did not is the one failure this template must never ship.
   */
  options = { usePhantomQuery: true };

  #release;

  constructor(handle, release, bounds) {
    super(handle, bounds);
    this.#release = release;
  }

  #finish(statement) {
    try {
      this.handle.prepare(statement).run();
    } catch (error) {
      // Released first, always: a group that could not be closed must not also
      // hold the only connection for everything queued behind it.
      this.#release();
      return refusalFor(error);
    }
    this.#release();
    return Promise.resolve();
  }

  commit() {
    return this.#finish('COMMIT');
  }

  rollback() {
    return this.#finish('ROLLBACK');
  }

  async createSavepoint(name) {
    await this.executeRaw({ sql: `SAVEPOINT ${requirePlainName(name)}`, args: [], argTypes: [] });
  }

  async rollbackToSavepoint(name) {
    await this.executeRaw({ sql: `ROLLBACK TO ${requirePlainName(name)}`, args: [], argTypes: [] });
  }

  async releaseSavepoint(name) {
    await this.executeRaw({
      sql: `RELEASE SAVEPOINT ${requirePlainName(name)}`,
      args: [],
      argTypes: [],
    });
  }
}

class Adapter extends Queryable {
  #turnstile = new Turnstile();

  #owned;

  /**
   * `owned` decides what `dispose` means, and getting it wrong is not cosmetic.
   *
   * The data layer keeps ONE handle for the whole process and hands it in; an
   * adapter that closed it when the runtime disconnected would close the store
   * out from under everything else still holding it. A throwaway store this file
   * opened itself is the opposite case, and closing that one is the only way it
   * ever gets closed.
   */
  constructor(handle, owned, bounds) {
    super(handle, bounds);
    this.#owned = owned === true;
  }

  executeScript(script) {
    try {
      this.handle.exec(script);
    } catch (error) {
      return refusalFor(error);
    }
    return Promise.resolve();
  }

  async startTransaction(isolationLevel) {
    // One connection means one level of isolation, and it is the strictest one.
    // Accepting a weaker request would be claiming a guarantee that is not here.
    if (isolationLevel !== undefined && isolationLevel !== 'SERIALIZABLE') {
      throw new Error(`this app's storage cannot use the ${String(isolationLevel)} setting`);
    }
    const release = await this.#turnstile.take();
    try {
      this.handle.prepare('BEGIN').run();
    } catch (error) {
      release();
      return refusalFor(error);
    }
    return new Group(this.handle, release, this.bounds);
  }

  dispose() {
    if (this.#owned) this.handle.close();
    return Promise.resolve();
  }
}

/**
 * Put a freshly opened handle into the state this app needs.
 *
 * Both settings are this file's job. The runtime above sets neither, and without
 * the first a read taken while a save is in flight fails outright instead of
 * waiting - which the development server, answering several requests at once,
 * produces immediately.
 */
export function prepareConnection(handle) {
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');
  return handle;
}

/**
 * Open storage at `file`, ready for the data layer.
 *
 * `file` is a path, never a location string with a scheme: the only caller is
 * `lib/data/index.js`, which already knows where this app keeps information.
 */
export function openStorage(file) {
  return prepareConnection(new DatabaseSync(file));
}

/**
 * What the data layer hands to its runtime: something that can open storage.
 *
 * The handle is created up front and shared, because this app keeps one handle
 * per process on purpose (`lib/data/index.js` explains why) and a factory that
 * opened a second one would quietly undo that.
 */
export class StorageAdapterFactory {
  provider = 'sqlite';
  adapterName = ADAPTER_NAME;

  #handle;
  #bounds;

  constructor(handle, bounds) {
    this.#handle = handle;
    this.#bounds = bounds;
  }

  connect() {
    return Promise.resolve(new Adapter(this.#handle, false, this.#bounds));
  }

  connectToShadowDb() {
    // Asked for only by the toolchain a finished app does not carry. A throwaway
    // in-memory copy is the honest answer; refusing would break commands that
    // legitimately need one.
    return Promise.resolve(new Adapter(openStorage(':memory:'), true));
  }
}
