/**
 * Refuse to start while a plaintext secrets file exists in the project.
 *
 * Tellop's invariant is that private values (provider keys, passwords, tokens)
 * live in the operating system's keychain and are handed to this app's process
 * when Tellop starts it - never written into a file inside the project (rule 2
 * of Tellop's general rulebook for apps).
 *
 * Next loads `.env`, `.env.local` and friends BY ITSELF, before it evaluates
 * `next.config.mjs`. So this is a refusal, not a prevention: by the time this
 * runs, a planted file's contents have already been read into this process's
 * environment. What the check buys is that the process then dies instead of
 * serving, so the plaintext file cannot quietly become the way this app is
 * configured, and the agent rule has a consequence rather than being advice.
 *
 * Fail-closed on purpose: a directory that cannot be read is a refusal too. A
 * check that reports "nothing found" when it could not look is the shape this
 * repository has been burned by more than once.
 */

import { readdirSync } from 'node:fs';

/**
 * Filenames that must never exist in a project directory.
 *
 * `.env*` because that is where a plaintext key ends up; `.npmrc`/`.netrc`
 * because those hold registry and host credentials and are read automatically
 * by tools this app's dependencies invoke.
 */
const REFUSED = /^\.env(\..+)?$|^\.envrc$|^\.npmrc$|^\.netrc$|^_netrc$/;

export class PlaintextSecretFileError extends Error {
  /** @param {readonly string[]} files */
  constructor(files) {
    super(
      [
        `This app will not start while these files exist: ${files.join(', ')}.`,
        'Private values are handed to the app when it starts, and are never kept in a file inside the project.',
        'Remove the file and start again.',
      ].join(' '),
    );
    this.name = 'PlaintextSecretFileError';
    /** @type {readonly string[]} */
    this.files = files;
  }
}

/**
 * @param {string} projectDir
 * @returns {void}
 */
export function assertNoPlaintextSecretFiles(projectDir) {
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = readdirSync(projectDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `This app will not start: its own folder could not be checked (${String(error)}).`,
    );
  }
  const found = entries
    .filter((entry) => !entry.isDirectory() && REFUSED.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (found.length > 0) throw new PlaintextSecretFileError(found);
}
