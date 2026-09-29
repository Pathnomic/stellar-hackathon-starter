/**
 * The words this app shows, checked.
 *
 * `lib/i18n/` states two rules about itself and this is what holds them: the
 * two locale files carry exactly the same keys, and the lookup fills in
 * `{name}`-style placeholders rather than printing them at a person.
 *
 * Both are checked against the real tables rather than against a copy written
 * here. A check that carries its own expected words only ever proves that
 * somebody typed the same thing twice.
 */

import assert from 'node:assert/strict';
import process from 'node:process';
import { after, test } from 'node:test';

import { DEFAULT_LOCALE, LOCALES, MESSAGES, getLocale, t } from '../lib/i18n/index.js';

test('both languages carry exactly the same keys', () => {
  const en = Object.keys(MESSAGES.en).sort();
  const tr = Object.keys(MESSAGES.tr).sort();
  assert.ok(en.length > 0, 'the English words are missing entirely');
  assert.deepEqual(tr, en);
  for (const [key, value] of Object.entries(MESSAGES.tr)) {
    assert.ok(value.trim().length > 0, `the Turkish words for ${key} are empty`);
  }
});

test('every language named is a language that exists', () => {
  assert.ok(LOCALES.includes(DEFAULT_LOCALE));
  for (const locale of LOCALES) assert.ok(MESSAGES[locale] !== undefined, locale);
});

test('the words cannot be changed while the app is running', () => {
  // Frozen where it is declared, so a feature that "just patches one string"
  // fails loudly here instead of quietly changing what everybody reads.
  assert.equal(Object.isFrozen(MESSAGES), true);
  assert.equal(Object.isFrozen(MESSAGES.en), true);
  assert.equal(Object.isFrozen(MESSAGES.tr), true);
  assert.equal(Object.isFrozen(LOCALES), true);
  assert.throws(() => {
    MESSAGES.en['app.title'] = 'something else';
  }, TypeError);
});

/**
 * The names a written line asks to be handed, read out of the line itself.
 *
 * A fresh matcher each time: a `/g` one carries its own position, so a shared
 * instance answers differently on its second question.
 */
function valueNamesIn(written) {
  return [...written.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
}

/**
 * Every key whose words ask for a value.
 *
 * Found rather than named, and the words themselves are never written out here:
 * they live in `lib/i18n/locales/` and change as this app grows, so a check that
 * spelled one out would go red the day somebody reworded a heading - which says
 * nothing at all about whether filling a value in still works.
 */
const TAKES_A_VALUE = Object.keys(MESSAGES.en).filter(
  (key) => valueNamesIn(MESSAGES.en[key]).length > 0,
);

/** Both checks below say this first: finding none would prove nothing. */
function assertSomethingTakesAValue() {
  assert.ok(TAKES_A_VALUE.length > 0, 'no line asks for a value, so nothing here was measured');
}

test('a value handed in is filled in, in every language', () => {
  assertSomethingTakesAValue();
  for (const key of TAKES_A_VALUE) {
    for (const locale of LOCALES) {
      const written = MESSAGES[locale][key];
      const handed = Object.fromEntries(valueNamesIn(written).map((name) => [name, `<${name}>`]));
      const filled = t(key, locale, handed);
      assert.notEqual(filled, written, `${locale} ${key}`);
      for (const [name, value] of Object.entries(handed)) {
        assert.ok(filled.includes(value), `${locale} ${key}: ${filled}`);
        assert.ok(!filled.includes(`{${name}}`), `${locale} ${key}: ${filled}`);
      }
    }
  }
});

test('a value nobody handed in is left showing rather than blanked', () => {
  assertSomethingTakesAValue();
  for (const key of TAKES_A_VALUE) {
    for (const locale of LOCALES) assert.equal(t(key, locale), MESSAGES[locale][key]);
  }
});

test('a word that is not there answers with its own key', () => {
  // The key is built rather than written into the call: a missing key spelled
  // out here would look like a key this app defines to anything reading the
  // source for the set it uses.
  const absent = ['notes', 'nothingIsFiledUnderThis'].join('.');
  assert.equal(t(absent), absent);
  assert.equal(t(absent, 'tr'), absent);
});

test('an unknown language falls back to the default one rather than emptying the page', () => {
  assert.equal(t('app.title', 'de'), t('app.title', DEFAULT_LOCALE));
});

const chosen = process.env.NEXT_PUBLIC_APP_LANGUAGE;
after(() => {
  if (chosen === undefined) delete process.env.NEXT_PUBLIC_APP_LANGUAGE;
  else process.env.NEXT_PUBLIC_APP_LANGUAGE = chosen;
});

test('the project language is read from the environment, and anything odd is English', () => {
  process.env.NEXT_PUBLIC_APP_LANGUAGE = 'tr';
  assert.equal(getLocale(), 'tr');
  process.env.NEXT_PUBLIC_APP_LANGUAGE = 'klingon';
  assert.equal(getLocale(), DEFAULT_LOCALE);
  delete process.env.NEXT_PUBLIC_APP_LANGUAGE;
  assert.equal(getLocale(), DEFAULT_LOCALE);
});
