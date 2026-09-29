/**
 * The fundraiser on the starting page, checked.
 *
 * The page shows one of two sets of numbers. Before the fundraiser is
 * published: an example, built from the settings file when it can be read
 * (the goal and the end date that publishing will set up) and from the example
 * data when it cannot. After: the contract's own numbers, as `readFundraiser`
 * reads them. Both go through the functions in `app/fundraiser-view.ts`, and
 * these checks call those functions with made-up settings and made-up readings,
 * so they depend neither on today's date nor on the network.
 *
 * Expected words are always looked up in `lib/i18n/locales/`, never written
 * here, so rewording a label never breaks a check about numbers.
 *
 * The last check reads this app's own `stellar/fundraiser.settings.json`: it
 * must stay a file that publishing can use. Whether its end date is still
 * ahead depends on the day, so it is checked against a day just before that
 * end date, never against today.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  exampleFigures,
  percentRaised,
  publishedFigures,
  readableAmount,
  readableEndDate,
  statusWords,
} from '../app/fundraiser-view.ts';
import { LOCALES, t } from '../lib/i18n/index.js';
import { SETTINGS_FILE, parseSettings, readSettingsText } from '../lib/stellar/deployment.ts';
import { EXAMPLE_GOAL, EXAMPLE_RAISED_PERCENT, exampleFundraiser } from '../lib/stellar/example-data.ts';
import { toStroops } from '../lib/stellar/network.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How a day is written on the page, for comparing without spelling a date out here. */
function writtenDay(locale, year, monthIndex, day) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, monthIndex, day, 12)),
  );
}

/** A fundraiser as `readFundraiser` answers for a published one. */
function reading(overrides = {}) {
  return {
    ok: true,
    contractId: 'CONTRACT',
    goal: '250',
    total: '100',
    deadline: Date.UTC(2026, 10, 16) / 1000,
    state: 'running',
    paused: false,
    withdrawn: false,
    beneficiary: 'BENEFICIARY',
    ...overrides,
  };
}

test('the example fundraiser has its own words in both languages', () => {
  const seen = new Map();
  for (const locale of LOCALES) {
    const example = exampleFundraiser(locale);
    for (const [part, words] of [
      ['title', example.title],
      ['story', example.story],
    ]) {
      assert.ok(words.trim().length > 0, `${locale} ${part} is empty`);
      assert.ok(!/^example\./u.test(words), `${locale} ${part} is a bare key: ${words}`);
    }
    assert.ok(example.updates.length > 0, `${locale} has no updates`);
    for (const update of example.updates) {
      assert.ok(update.when.trim().length > 0 && update.text.trim().length > 0, `${locale} has an empty update`);
      assert.ok(!/^example\./u.test(update.when) && !/^example\./u.test(update.text), `${locale} update is a bare key`);
    }
    seen.set(locale, example.story);
  }
  // Translated rather than copied: the two languages do not read the same.
  assert.notEqual(seen.get('tr'), seen.get('en'));
  assert.ok(toStroops(EXAMPLE_GOAL) !== null, 'the example goal is not an amount of test money');
  assert.ok(Number.isInteger(EXAMPLE_RAISED_PERCENT) && EXAMPLE_RAISED_PERCENT >= 0 && EXAMPLE_RAISED_PERCENT <= 100);
});

test('amounts are written the reader’s way, and anything that is not an amount is refused', () => {
  assert.equal(readableAmount('1000', 'en'), '1,000');
  assert.equal(readableAmount('1000', 'tr'), '1.000');
  assert.equal(readableAmount('12.5', 'en'), '12.5');
  assert.equal(readableAmount('12.5', 'tr'), '12,5');
  assert.equal(readableAmount('1000000.0000001', 'en'), '1,000,000.0000001');
  assert.equal(readableAmount('10000.0000000', 'en'), '10,000');
  assert.equal(readableAmount('0', 'en'), '0');
  for (const odd of ['', '-1', '1e3', '12,5', ' 12.5', 'abc', '1.12345678']) {
    assert.equal(readableAmount(odd, 'en'), null, JSON.stringify(odd));
  }
});

test('progress is a whole percent, never past the goal and never below nothing', () => {
  assert.equal(percentRaised('420', '1000'), 42);
  assert.equal(percentRaised('0', '1000'), 0);
  assert.equal(percentRaised('999.9999999', '1000'), 99);
  assert.equal(percentRaised('1500', '1000'), 100);
  assert.equal(percentRaised('10', '0'), 0);
  assert.equal(percentRaised('abc', '1000'), 0);
});

test('the end date shown is the last day donations are taken', () => {
  // "2026-11-15" in the settings ends at the next midnight, UTC: the 15th is the last day.
  const endOfThe15th = Date.UTC(2026, 10, 16) / 1000;
  for (const locale of LOCALES) {
    assert.equal(readableEndDate(endOfThe15th, locale), writtenDay(locale, 2026, 10, 15));
  }
  for (const odd of [0, -5, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.equal(readableEndDate(odd, 'en'), null, String(odd));
  }
});

test('before publishing, the example follows the settings file and says it is not published', () => {
  const settings = parseSettings(
    { goal: 1000, endsAt: '2026-11-15', beneficiary: 'app-account' },
    new Date('2026-10-05T12:00:00Z'),
  );
  assert.equal(settings.ok, true);
  for (const locale of LOCALES) {
    const figures = exampleFigures(settings, locale);
    assert.equal(figures.goal, t('stellar.testMoney', locale, { amount: readableAmount('1000', locale) }));
    assert.equal(figures.raised, t('stellar.testMoney', locale, { amount: readableAmount('420', locale) }));
    assert.equal(figures.percent, EXAMPLE_RAISED_PERCENT);
    assert.equal(figures.endsOn, writtenDay(locale, 2026, 10, 15));
    assert.equal(figures.status, t('fundraiser.stateNotPublished', locale));
  }
  // A goal with decimals is counted exactly.
  const small = parseSettings({ goal: 12.5, endsAt: '2026-11-15', beneficiary: 'app-account' }, new Date('2026-10-05T12:00:00Z'));
  assert.equal(exampleFigures(small, 'en').raised, t('stellar.testMoney', 'en', { amount: '5.25' }));
});

test('before publishing, a settings file that cannot be read falls back to the example goal and no end date', () => {
  for (const reason of ['missing', 'not-json', 'ends-in-past']) {
    const figures = exampleFigures({ ok: false, reason }, 'en');
    assert.equal(figures.goal, t('stellar.testMoney', 'en', { amount: readableAmount(EXAMPLE_GOAL, 'en') }));
    assert.equal(figures.endsOn, null, reason);
    assert.equal(figures.status, t('fundraiser.stateNotPublished', 'en'));
  }
});

test('after publishing, the figures are the contract’s own', () => {
  const figures = publishedFigures(reading(), 'en');
  assert.deepEqual(figures, {
    raised: t('stellar.testMoney', 'en', { amount: '100' }),
    goal: t('stellar.testMoney', 'en', { amount: '250' }),
    endsOn: writtenDay('en', 2026, 10, 15),
    status: t('fundraiser.stateRunning', 'en'),
    percent: 40,
  });
  assert.equal(publishedFigures(reading({ total: '300', state: 'succeeded' }), 'en')?.percent, 100);
  assert.equal(publishedFigures(reading({ total: 'lots' }), 'en'), null);
  assert.equal(publishedFigures(reading({ goal: '' }), 'tr'), null);
});

test('where a published fundraiser stands is said in words for every state', () => {
  const cases = [
    [{ state: 'running', paused: false }, 'fundraiser.stateRunning'],
    [{ state: 'running', paused: true }, 'fundraiser.statePaused'],
    [{ state: 'succeeded', withdrawn: false }, 'fundraiser.stateSucceeded'],
    [{ state: 'succeeded', withdrawn: true }, 'fundraiser.stateWithdrawn'],
    // Paused only matters while it runs: after the end, the result is what counts.
    [{ state: 'succeeded', paused: true }, 'fundraiser.stateSucceeded'],
    [{ state: 'failed', paused: true }, 'fundraiser.stateFailed'],
  ];
  for (const locale of LOCALES) {
    for (const [overrides, key] of cases) {
      assert.equal(statusWords(reading(overrides), locale), t(key, locale), `${locale} ${JSON.stringify(overrides)}`);
    }
  }
});

test('this app’s settings file is one that publishing can use', () => {
  const text = readFileSync(new URL(`../${SETTINGS_FILE}`, import.meta.url), 'utf8');
  const { endsAt } = JSON.parse(text);
  assert.equal(typeof endsAt, 'string', 'the settings file has no end date');
  const ends = Date.parse(/^\d{4}-\d{2}-\d{2}$/u.test(endsAt) ? `${endsAt}T00:00:00Z` : endsAt);
  assert.ok(Number.isFinite(ends), `the end date is not a date: ${endsAt}`);
  // A day before it ends: the day of the check never decides the answer.
  const reading = readSettingsText(text, new Date(ends - DAY_MS));
  assert.deepEqual(reading.ok ? 'ok' : reading.reason, 'ok');
});
