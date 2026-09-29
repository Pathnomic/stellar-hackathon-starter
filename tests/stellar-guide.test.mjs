/**
 * The Stellar rules and guide this app's AI reads, checked.
 *
 * `AGENTS.md` and `docs/stellar/` are written for the AI that builds this app,
 * so their words are what they deliver: these checks read the files themselves,
 * which is the one place `AGENTS.md` rule 9's warning about checks that read
 * source text does not reach.
 *
 * The AI reads at most about 50 KB of a file in one look, so the rulebook stays
 * under 50 KB and every guide file under 40 KB. The guide's index names every
 * file in its folder and nothing that is not there. Section 11 still states the
 * Stellar rules the rest of this app is built around. And neither the rulebook
 * nor the guide holds a line Tellop's save check reads as a stored sign-in: that
 * check refuses every save of the project until such a line goes.
 *
 * Nothing here reaches the network.
 */

import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = path.join(ROOT, 'docs', 'stellar');
const RULEBOOK = path.join(ROOT, 'AGENTS.md');

/** Bytes. Kept well under the 50 KB the AI reads in one look. */
const GUIDE_FILE_LIMIT = 40_000;
const RULEBOOK_LIMIT = 50_000;

function guideFiles() {
  return readdirSync(GUIDE).sort();
}

test('every guide file is a plain file small enough to read in one look', () => {
  const names = guideFiles();
  // Non-vacuous: the folder holds the index and its topic files, not nothing.
  assert.ok(names.includes('INDEX.md'), 'the guide has no INDEX.md');
  assert.ok(names.filter((name) => name.endsWith('.md')).length >= 4, 'the guide has almost no topic files');
  const tooBig = [];
  for (const name of names) {
    const info = lstatSync(path.join(GUIDE, name));
    assert.ok(info.isFile(), `${name} is not a plain file`);
    if (info.size >= GUIDE_FILE_LIMIT) tooBig.push(`${name}: ${info.size} bytes`);
  }
  assert.deepEqual(tooBig, []);
});

test('the guide index names every file in the guide, and none that is missing', () => {
  const index = readFileSync(path.join(GUIDE, 'INDEX.md'), 'utf8');
  // The index's table: one row per file, its name in backticks in the first cell.
  const named = [...index.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]).sort();
  assert.ok(named.length > 0, 'the index has no table of files');
  assert.deepEqual(named, guideFiles().filter((name) => name !== 'INDEX.md'));
});

test('the rulebook is small enough to read in one look', () => {
  const size = lstatSync(RULEBOOK).size;
  assert.ok(size > 1_000, `AGENTS.md is only ${size} bytes`);
  assert.ok(size < RULEBOOK_LIMIT, `AGENTS.md is ${size} bytes`);
});

/** Section 11 of the rulebook, cut at the next section, never the rest of the file. */
function stellarSection(text) {
  const start = text.indexOf('\n## 11. Stellar\n');
  assert.ok(start >= 0, 'AGENTS.md has no "## 11. Stellar" section');
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next < 0 ? text.length : next);
}

/** Line breaks inside a sentence are not part of what it says. */
const oneLine = (text) => text.replace(/\s+/g, ' ');

test('the rulebook states the Stellar rules this app is built around', () => {
  const rulebook = readFileSync(RULEBOOK, 'utf8');
  const section = oneLine(stellarSection(rulebook));
  for (const phrase of [
    'Every Stellar call goes through `lib/stellar/`.',
    'never write signing code of your own',
    'No Stellar secret key or recovery phrase ever enters this app.',
    'sign with one in code',
    'The test network only, never the main network.',
    'Never write, change or add a smart contract.',
    "The contract's settings live in `stellar/fundraiser.settings.json`, and only there.",
    'ahead of now and at most 90 days away',
    'Read the published contract only through `loadDeployment()`',
    "export const dynamic = 'force-dynamic'",
    'Never import `stellar/deployment.json`',
    "Freighter lives in the person's own browser.",
    '`insideTellopPreview()`',
    'Never do money sums with ordinary numbers.',
    'name such fields for what they hold',
    'read `docs/stellar/INDEX.md` first',
  ]) {
    assert.ok(section.toLowerCase().includes(phrase.toLowerCase()), `section 11 no longer says: ${phrase}`);
  }
  // The rules around section 11 are Tellop's general rulebook, which this
  // repository does not carry, so their eight rows are not checked here.
});

/*
 * Tellop's save check refuses a project file with a line shaped like a stored
 * sign-in. These are copies of the two shapes it checks that this kit's own
 * writing has run into: a name ending in "token", "secret", "password", "auth" or
 * "key" given a long value that is not a placeholder, and a sign-in written into
 * a request. Keep them in step with Tellop's own (`SECRET_ASSIGNMENT` and
 * `PLACEHOLDER_VALUE` in its denylist). A Stellar secret key has a shape of its
 * own, and `AGENTS.md` rule 2 keeps one out of every file.
 */
const SIGN_IN_LINE =
  /(?:^|[^A-Za-z0-9_])([A-Za-z0-9_]{0,63}(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|_KEY|KEY_|APIKEY|AUTH)[0-9_]{0,16})\s*[:=]\s*["'`]?([^\s"'`,;]{12,})["'`]?/i;
const NOT_A_VALUE =
  /^(?:process\.env|import\.meta|\$\{|\$\(|<|your[-_]?|xxx+|placeholder|changeme|example|replace[-_]?me|todo|null|undefined|true|false)/i;
const SIGN_IN_HEADER = /\bAuthorization\s*:\s*(?:Basic|Bearer|token)\s+\S{8,}/i;
const STELLAR_SEED_SHAPE = /\bS[A-Z2-7]{55}\b/;

/** The lines of `text` the save check would read as a stored sign-in, by number. */
function signInLines(text) {
  const found = [];
  for (const [index, line] of text.split('\n').entries()) {
    const assignment = SIGN_IN_LINE.exec(line);
    const valued = assignment !== null && !NOT_A_VALUE.test(assignment[2]);
    if (valued || SIGN_IN_HEADER.test(line) || STELLAR_SEED_SHAPE.test(line)) found.push(`line ${index + 1}`);
  }
  return found;
}

test('neither the rulebook nor the guide holds a line read as a stored sign-in', () => {
  const files = [RULEBOOK, ...guideFiles().map((name) => path.join(GUIDE, name))];
  assert.ok(files.length > 2, 'nothing was read');
  const found = [];
  for (const file of files) {
    for (const where of signInLines(readFileSync(file, 'utf8'))) found.push(`${path.relative(ROOT, file)} ${where}`);
  }
  assert.deepEqual(found, []);
});

test('the sign-in check does catch such a line, and leaves the names the rules ask for alone', () => {
  // Built here rather than written out, so this file never holds such a line itself.
  const value = 'q'.repeat(20);
  const token = ['to', 'ken'].join('');
  assert.deepEqual(signInLines(`const ${token}: '${value}';`), ['line 1']);
  assert.deepEqual(signInLines(`first line\n${['au', 'th'].join('')} = ${value}`), ['line 2']);
  assert.deepEqual(signInLines(`${['Author', 'ization'].join('')}: Bearer ${value}`), ['line 1']);
  assert.deepEqual(signInLines(`S${'A'.repeat(55)}`), ['line 1']);
  assert.deepEqual(signInLines(`${token}Address: '${value}'`), []);
  assert.deepEqual(signInLines(`${token}: '<value>'`), []);
});
