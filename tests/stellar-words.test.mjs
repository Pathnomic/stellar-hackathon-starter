/**
 * The Stellar words this app shows, checked.
 *
 * Every call in `lib/stellar/` that says "no" names its reason from
 * `STELLAR_PROBLEMS`, and a page shows words for it through
 * `app/stellar-problems.ts`. This holds every reason to having words in both
 * languages, found through the same function the page calls, so a reason added
 * to the library without words, or words added under a key nothing uses, fails
 * here rather than on a person's screen as a bare key.
 *
 * It also holds every word in `lib/i18n/locales/` to `AGENTS.md` rule 5: none
 * of the words that describe machinery.
 *
 * Both checks read the real tables, never a copy of the words written here.
 * Nothing here reaches the network.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROBLEM_MESSAGE_KEYS, problemWords } from '../app/stellar-problems.ts';
import { LOCALES, MESSAGES, t } from '../lib/i18n/index.js';
import { STELLAR_PROBLEMS } from '../lib/stellar/network.ts';

test('every reason a Stellar call can give has its own words, in both languages', () => {
  assert.ok(STELLAR_PROBLEMS.length > 0, 'the library names no reasons, so nothing here was measured');
  assert.deepEqual(Object.keys(PROBLEM_MESSAGE_KEYS).sort(), [...STELLAR_PROBLEMS].sort());
  const keys = STELLAR_PROBLEMS.map((reason) => PROBLEM_MESSAGE_KEYS[reason]);
  assert.equal(new Set(keys).size, keys.length, 'two reasons share one message');
  for (const reason of STELLAR_PROBLEMS) {
    const key = PROBLEM_MESSAGE_KEYS[reason];
    for (const locale of LOCALES) {
      const written = MESSAGES[locale][key];
      assert.equal(typeof written, 'string', `${locale} has no words for ${reason} (${key})`);
      assert.ok(written.trim().length > 0, `${locale} words for ${reason} are empty`);
      // The page's own function, not the table: this is what a person would read.
      assert.equal(problemWords(reason, locale), written, `${locale} ${reason}`);
    }
  }
});

test('a reason this page does not know still reads as words, never as a bare key', () => {
  const general = t(PROBLEM_MESSAGE_KEYS['unexpected-answer'], 'en');
  // Built rather than written out, so it can never be mistaken for a real reason.
  const unknown = ['no', 'such', 'reason'].join('-');
  for (const reason of [unknown, 'constructor', 'toString']) {
    assert.equal(problemWords(reason, 'en'), general, reason);
  }
});

/**
 * `AGENTS.md` rule 5: words that describe how the app works inside rather than
 * what the reader sees. The same list as the check in Tellop's own suite that
 * qualifies this starting kit; change both together.
 */
const MACHINERY_WORDS = Object.freeze([
  'table',
  'column',
  'migration',
  'sql',
  'schema',
  'constraint',
  'index',
  'transaction',
  'rollback',
  'branch',
  'commit',
  'merge',
]);

/** The machinery words in `text`, plurals included: "tables" is the same word to a reader. */
function machineryIn(text) {
  return MACHINERY_WORDS.filter((word) => new RegExp(`\\b${word}(?:e?s)?\\b`, 'i').test(text));
}

test('no word a person reads describes the machinery, in either language', () => {
  const found = [];
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(MESSAGES[locale])) {
      for (const word of machineryIn(value)) found.push(`${locale} ${key}: ${word}`);
    }
  }
  assert.deepEqual(found, []);
});

test('the machinery check does catch a machinery word', () => {
  // Without this, a check that could never fire would pass as well as one that works.
  assert.deepEqual(machineryIn('Your payment is in the transaction list.'), ['transaction']);
  assert.deepEqual(machineryIn('Two new Tables were added.'), ['table']);
  assert.deepEqual(machineryIn('Your payment went through.'), []);
});
