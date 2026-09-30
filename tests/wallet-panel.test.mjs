/**
 * The wallet panel on the starting page, checked without a browser, a wallet
 * or a network.
 *
 * The panel decides what to show in `app/wallet-view.ts` and reads typed
 * amounts in `app/amount-text.ts`, both pure, so these checks call them with
 * made-up states and typed text. What a wallet button shows while it works,
 * and the run that always ends its wait, are in `app/wallet-wait.ts`, whose
 * one timer runs here on a mock clock. Expected words are always looked up in
 * `lib/i18n/locales/`, never written here.
 *
 * The last checks hold the words themselves: every word this app shows is
 * looked up by a key written out in its code (Tellop's word checks look for
 * exactly that), every key it looks up exists, and the panel's words use none
 * of the words that describe how Stellar works inside.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { amountProblemWords, readAmount } from '../app/amount-text.ts';
import { fundraiserStep, panelView, shortAddress } from '../app/wallet-view.ts';
import { SLOW_APPROVAL_MS, followChange, waitView, watchChanges } from '../app/wallet-wait.ts';
import { LOCALES, MESSAGES } from '../lib/i18n/index.js';

import { BENEFICIARY, CONTRACT_ID, WALLET } from './fixtures/stellar/fake-network.mjs';

const ME = WALLET.publicKey();
const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------------ */
/* Typed amounts                                                            */
/* ------------------------------------------------------------------------ */

function amountOf(typed, locale) {
  const reading = readAmount(typed, locale);
  return reading.ok ? reading.amount : reading.problem;
}

test('a comma is the decimal mark in Turkish, and the amount reaches the library with a point', () => {
  assert.deepEqual(readAmount('12,5', 'tr'), { ok: true, amount: '12.5', stroops: BigInt(125_000_000) });
  assert.equal(amountOf('0,0000001', 'tr'), '0.0000001');
  assert.equal(amountOf('1,000', 'tr'), '1.000');
  assert.equal(amountOf(' 12,5 ', 'tr'), '12.5');
  assert.equal(amountOf('12,', 'tr'), '12');
});

test('a point is the decimal mark in English, and works in Turkish where it cannot be separating thousands', () => {
  assert.deepEqual(readAmount('12.5', 'en'), { ok: true, amount: '12.5', stroops: BigInt(125_000_000) });
  assert.equal(amountOf('1.000', 'en'), '1.000');
  assert.equal(amountOf('10000', 'en'), '10000');
  assert.equal(amountOf('007', 'en'), '7');
  assert.equal(amountOf('12.5', 'tr'), '12.5');
  assert.equal(amountOf('0.125', 'tr'), '0.125');
  assert.equal(amountOf('1.5', 'tr'), '1.5');
  // English readers writing a decimal comma are read too, where it cannot be thousands.
  assert.equal(amountOf('1,5', 'en'), '1.5');
  assert.equal(amountOf('0,125', 'en'), '0.125');
});

test('a mark that could be separating thousands is refused rather than read a thousand times too small', () => {
  // This page writes a thousand as "1.000" in Turkish and "1,000" in English.
  assert.equal(amountOf('1.000', 'tr'), 'thousands');
  assert.equal(amountOf('25.000', 'tr'), 'thousands');
  assert.equal(amountOf('1,000', 'en'), 'thousands');
  assert.equal(amountOf('1.000,5', 'tr'), 'not-a-number');
  assert.equal(amountOf('1,000.5', 'en'), 'not-a-number');
  assert.equal(amountOf('1 000', 'tr'), 'not-a-number');
});

test('more than 7 decimals is refused, never rounded', () => {
  assert.equal(amountOf('1,12345678', 'tr'), 'too-many-decimals');
  assert.equal(amountOf('0.00000001', 'en'), 'too-many-decimals');
  assert.equal(amountOf('1.1234567', 'en'), '1.1234567');
});

test('empty, zero, negative, too large and not-a-number are each refused', () => {
  for (const locale of LOCALES) {
    assert.equal(amountOf('', locale), 'empty');
    assert.equal(amountOf('   ', locale), 'empty');
    assert.equal(amountOf('0', locale), 'not-positive');
    assert.equal(amountOf('0,0', locale), 'not-positive');
    assert.equal(amountOf('0.0000000', locale), 'not-positive');
    assert.equal(amountOf('-1', locale), 'not-positive');
    assert.equal(amountOf('−5', locale), 'not-positive');
    assert.equal(amountOf('1234567890123', locale), 'too-large');
    assert.equal(amountOf('922337203685.4775808', locale), 'too-large');
    assert.equal(amountOf('922337203685.4775807', locale), '922337203685.4775807');
    for (const odd of ['1e3', 'abc', '12.5.1', '+5', '.5', 'Infinity', '٣']) {
      assert.equal(amountOf(odd, locale), 'not-a-number', `${locale} ${JSON.stringify(odd)}`);
    }
  }
});

test('every amount problem has its own words in both languages', () => {
  const problems = ['empty', 'not-a-number', 'thousands', 'too-many-decimals', 'not-positive', 'too-large'];
  for (const locale of LOCALES) {
    for (const problem of problems) {
      const words = amountProblemWords(problem, locale);
      assert.ok(typeof words === 'string' && words.trim().length > 0, `${locale} ${problem}`);
      assert.ok(!/^(wallet|error)\.[A-Za-z]+$/.test(words), `${locale} ${problem} shows a bare key: ${words}`);
    }
  }
  assert.notEqual(amountProblemWords('too-many-decimals', 'tr'), amountProblemWords('too-many-decimals', 'en'));
});

/* ------------------------------------------------------------------------ */
/* What the panel shows                                                     */
/* ------------------------------------------------------------------------ */

/** A published fundraiser as `readFundraiser` answers it. */
function reading(overrides = {}) {
  return {
    ok: true,
    contractId: CONTRACT_ID,
    goal: '1000',
    total: '420',
    deadline: Date.UTC(2026, 10, 16) / 1000,
    state: 'running',
    paused: false,
    withdrawn: false,
    beneficiary: BENEFICIARY.publicKey(),
    ...overrides,
  };
}

const FUNDED = Object.freeze({ kind: 'funded', testMoney: '10000' });
const NOTHING_GIVEN = Object.freeze({ kind: 'known', amount: '0' });

function connected(overrides = {}) {
  return {
    wallet: { kind: 'connected', address: ME },
    balance: FUNDED,
    published: true,
    fundraiser: reading(),
    contribution: NOTHING_GIVEN,
    ...overrides,
  };
}

function viewOf(wallet) {
  return panelView({ ...connected(), wallet });
}

test('before it has looked, the panel says it is looking, on the server and in the browser alike', () => {
  assert.deepEqual(viewOf({ kind: 'checking' }), { kind: 'checking' });
});

test('inside Tellop’s preview the panel only points to the browser, with nothing to connect', () => {
  assert.deepEqual(viewOf({ kind: 'preview' }), { kind: 'preview' });
});

test('without Freighter the panel says so, and without a wallet nothing else is offered', () => {
  assert.deepEqual(viewOf({ kind: 'missing' }), { kind: 'no-wallet' });
  assert.deepEqual(viewOf({ kind: 'ready', problem: null }), { kind: 'connect', busy: false, problem: null });
  assert.deepEqual(viewOf({ kind: 'ready', problem: 'declined' }), { kind: 'connect', busy: false, problem: 'declined' });
  assert.deepEqual(viewOf({ kind: 'connecting' }), { kind: 'connect', busy: true, problem: null });
});

test('a wallet on another network is asked to switch, and offered nothing else', () => {
  assert.deepEqual(viewOf({ kind: 'wrong-network', address: ME, busy: false }), {
    kind: 'wrong-network',
    address: ME,
    busy: false,
  });
});

test('a wallet without test money is offered test money first, and nothing that needs it', () => {
  const view = panelView(connected({ balance: { kind: 'not-funded' } }));
  assert.equal(view.kind, 'wallet');
  assert.deepEqual(view.balance, { kind: 'not-funded' });
  assert.equal(view.canSend, false);
  assert.equal(view.fundraiser, null);
  for (const balance of [{ kind: 'reading' }, { kind: 'problem', reason: 'unreachable' }]) {
    const waiting = panelView(connected({ balance }));
    assert.equal(waiting.canSend, false, balance.kind);
    assert.equal(waiting.fundraiser, null, balance.kind);
  }
});

test('a wallet with test money can send it and donate while the fundraiser runs', () => {
  const view = panelView(connected());
  assert.deepEqual(view, {
    kind: 'wallet',
    address: ME,
    balance: FUNDED,
    canSend: true,
    fundraiser: { kind: 'donate', given: null },
  });
  const given = panelView(connected({ contribution: { kind: 'known', amount: '25' } }));
  assert.deepEqual(given.fundraiser, { kind: 'donate', given: '25' });
  assert.deepEqual(panelView(connected({ fundraiser: reading({ paused: true }) })).fundraiser, { kind: 'paused', given: null });
});

test('before publishing, test money can be sent and donating waits for the fundraiser', () => {
  const view = panelView(connected({ published: false, fundraiser: null }));
  assert.equal(view.canSend, true);
  assert.deepEqual(view.fundraiser, { kind: 'not-published' });
});

test('while the fundraiser is being read, or cannot be read, nothing is offered for it', () => {
  assert.deepEqual(panelView(connected({ fundraiser: null })).fundraiser, { kind: 'reading' });
  assert.deepEqual(panelView(connected({ fundraiser: { ok: false, reason: 'unreachable' } })).fundraiser, {
    kind: 'problem',
    reason: 'unreachable',
  });
});

test('ended at its goal: collect the money, until it has been paid out', () => {
  const reached = reading({ state: 'succeeded', total: '1000' });
  assert.deepEqual(panelView(connected({ fundraiser: reached })).fundraiser, { kind: 'collect', given: null });
  // Anyone may collect it, a supporter or not; the money only ever goes to the beneficiary.
  assert.deepEqual(panelView(connected({ fundraiser: reached, contribution: { kind: 'known', amount: '25' } })).fundraiser, {
    kind: 'collect',
    given: '25',
  });
  const paid = reading({ state: 'succeeded', total: '1000', withdrawn: true });
  assert.deepEqual(panelView(connected({ fundraiser: paid })).fundraiser, { kind: 'paid-out', given: null });
});

test('ended short of its goal: a supporter gets their money back, anyone else is told there is nothing to take back', () => {
  const short = reading({ state: 'failed' });
  assert.deepEqual(panelView(connected({ fundraiser: short, contribution: { kind: 'known', amount: '25.5' } })).fundraiser, {
    kind: 'refund',
    given: '25.5',
  });
  assert.deepEqual(panelView(connected({ fundraiser: short })).fundraiser, { kind: 'nothing-to-refund' });
  assert.deepEqual(panelView(connected({ fundraiser: short, contribution: { kind: 'reading' } })).fundraiser, { kind: 'reading' });
  assert.deepEqual(
    panelView(connected({ fundraiser: short, contribution: { kind: 'problem', reason: 'busy' } })).fundraiser,
    { kind: 'problem', reason: 'busy' },
  );
  // A refund is never offered while the fundraiser runs or after it reached its goal.
  for (const state of ['running', 'succeeded']) {
    const step = fundraiserStep(true, reading({ state }), { kind: 'known', amount: '25.5' });
    assert.notEqual(step.kind, 'refund', state);
  }
});

test('a wallet address is shortened to its first and last four characters', () => {
  assert.equal(shortAddress(ME), `${ME.slice(0, 4)}…${ME.slice(-4)}`);
  assert.equal(shortAddress('GABC'), 'GABC');
});

/* ------------------------------------------------------------------------ */
/* While a wallet button works                                              */
/* ------------------------------------------------------------------------ */

// A change's three steps, then the two buttons that keep their own busy words.
const STEP_KEYS = Object.freeze({
  preparing: 'wallet.stepPreparing',
  approving: 'wallet.stepApprove',
  sending: 'wallet.stepSending',
  connecting: 'wallet.connecting',
  funding: 'wallet.gettingTestMoney',
});
const STAGES = Object.keys(STEP_KEYS);
const opening = (locale) => MESSAGES[locale]['wallet.freighterOpening'];
const where = (locale) => MESSAGES[locale]['wallet.freighterWhere'];

/** Runs `check` with a follower on a mock clock, handing it everything the follower showed so far. */
function followed(check) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const shown = [];
    check(followChange((wait) => shown.push(wait)), shown);
  } finally {
    mock.timers.reset();
  }
}

test('while a button works, it shows a working mark and its busy words; at rest, neither', () => {
  for (const locale of LOCALES) {
    assert.deepEqual(waitView(null, locale), { working: false, step: null, lines: [] });
    for (const stage of STAGES) {
      for (const slow of [false, true]) {
        const view = waitView({ stage, slow }, locale);
        assert.equal(view.working, true, `${locale} ${stage}: no working mark`);
        assert.equal(view.step, MESSAGES[locale][STEP_KEYS[stage]], `${locale} ${stage}`);
      }
    }
  }
});

test('the line saying Freighter is opening shows only while Freighter is awaited: approving, or connecting', () => {
  for (const locale of LOCALES) {
    for (const stage of ['approving', 'connecting']) {
      assert.deepEqual(waitView({ stage, slow: false }, locale).lines, [opening(locale)], `${locale} ${stage}`);
    }
    for (const stage of ['preparing', 'sending', 'funding']) {
      for (const slow of [false, true]) {
        assert.deepEqual(waitView({ stage, slow }, locale).lines, [], `${locale} ${stage}`);
      }
    }
  }
});

test('where to find Freighter is said only once it has been awaited for ten seconds', () => {
  assert.equal(SLOW_APPROVAL_MS, 10_000);
  followed((follower, shown) => {
    // Only a wait in Freighter is ever "slow": no timer runs for the others.
    for (const stage of ['preparing', 'sending', 'funding']) {
      follower.moveTo(stage);
      mock.timers.tick(SLOW_APPROVAL_MS * 2);
      assert.deepEqual(shown.at(-1), { stage, slow: false }, stage);
    }
    follower.moveTo('approving');
    mock.timers.tick(SLOW_APPROVAL_MS - 1);
    assert.deepEqual(shown.at(-1), { stage: 'approving', slow: false });
    mock.timers.tick(1);
    assert.deepEqual(shown.at(-1), { stage: 'approving', slow: true });
    for (const locale of LOCALES) assert.deepEqual(waitView(shown.at(-1), locale).lines, [opening(locale), where(locale)]);
  });
});

test('both lines go as soon as the approval ends, and its timer goes with them', () => {
  followed((follower, shown) => {
    // Approved within ten seconds: the second line never comes.
    follower.moveTo('approving');
    mock.timers.tick(SLOW_APPROVAL_MS / 2);
    follower.moveTo('sending');
    mock.timers.tick(SLOW_APPROVAL_MS * 2);
    assert.deepEqual(shown.at(-1), { stage: 'sending', slow: false });
    for (const locale of LOCALES) assert.deepEqual(waitView(shown.at(-1), locale).lines, []);
    // Approved after ten seconds: both lines go, and the next approval waits afresh.
    follower.moveTo(null);
    follower.moveTo('approving');
    mock.timers.tick(SLOW_APPROVAL_MS);
    assert.deepEqual(shown.at(-1), { stage: 'approving', slow: true });
    follower.moveTo(null);
    assert.equal(shown.at(-1), null);
    follower.moveTo('approving');
    mock.timers.tick(SLOW_APPROVAL_MS - 1);
    assert.deepEqual(shown.at(-1), { stage: 'approving', slow: false });
    // The action leaves the page mid-approval: nothing more is shown, the timer included.
    const before = shown.length;
    follower.stop();
    mock.timers.tick(SLOW_APPROVAL_MS * 2);
    follower.moveTo('sending');
    assert.equal(shown.length, before);
  });
});

/**
 * Runs `check` with a watch on a mock clock, started as a button arriving on
 * the page starts it, handing it what was shown and each busy flag set.
 */
async function watched(check) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const shown = [];
    const held = [];
    const watch = watchChanges((wait) => shown.push(wait));
    watch.start();
    await check({ watch, shown, held, onBusy: (busy) => held.push(busy) });
  } finally {
    mock.timers.reset();
  }
}

/** A change that reports `steps`, then ends the way `end` does: with an answer, or by throwing. */
const changeThat = (steps, end) => async (onStage) => {
  for (const stage of steps) onStage(stage);
  return end();
};

const ENDINGS = Object.freeze([
  { how: 'went through', steps: ['preparing', 'approving', 'sending'], end: () => ({ ok: true, hash: 'a'.repeat(64) }) },
  { how: 'was declined', steps: ['preparing', 'approving'], end: () => ({ ok: false, reason: 'declined', hash: null }) },
  {
    how: 'threw',
    steps: ['preparing', 'approving'],
    end: () => {
      throw new Error('the wallet went away');
    },
  },
]);

for (const { how, steps, end } of ENDINGS) {
  test(`a change that ${how} ends its wait: at rest, the page let go, and no timer left behind`, async () => {
    await watched(async ({ watch, shown, held, onBusy }) => {
      const ended = await watch.run(changeThat(steps, end), onBusy).then(
        (answer) => ({ answer }),
        (error) => ({ error }),
      );
      if (how === 'threw') assert.equal(ended.error?.message, 'the wallet went away', 'the failure did not reach the caller');
      else assert.deepEqual(ended.answer, end());
      assert.deepEqual(shown, [...steps.map((stage) => ({ stage, slow: false })), null], 'the wait did not end at rest');
      assert.deepEqual(held, [true, false], 'the page was not let go');
      mock.timers.tick(SLOW_APPROVAL_MS * 2);
      assert.equal(shown.at(-1), null, "the approval's timer outlived it");
    });
  });
}

test('connecting the wallet keeps its own busy words, says Freighter is opening, and after ten seconds where to find it', async () => {
  await watched(async ({ watch, shown }) => {
    let answer;
    const connecting = watch.run(async (onStage) => {
      onStage('connecting');
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    for (const locale of LOCALES) {
      const view = waitView(shown.at(-1), locale);
      assert.deepEqual(view, { working: true, step: MESSAGES[locale]['wallet.connecting'], lines: [opening(locale)] }, locale);
    }
    mock.timers.tick(SLOW_APPROVAL_MS);
    for (const locale of LOCALES) assert.deepEqual(waitView(shown.at(-1), locale).lines, [opening(locale), where(locale)]);
    answer({ ok: true, address: ME });
    assert.deepEqual(await connecting, { ok: true, address: ME });
    assert.equal(shown.at(-1), null);
  });
});

test('a button that leaves the page shows nothing more but still lets the page go, and one put back follows afresh', async () => {
  await watched(async ({ watch, shown, held, onBusy }) => {
    // React's strict mode takes a new button off the page and puts it back once: it still follows.
    watch.stop();
    watch.start();
    let approve;
    const running = watch.run(async (onStage) => {
      onStage('approving');
      return new Promise((resolve) => {
        approve = resolve;
      });
    }, onBusy);
    assert.deepEqual(shown, [{ stage: 'approving', slow: false }]);
    // Now it leaves while Freighter is awaited.
    watch.stop();
    mock.timers.tick(SLOW_APPROVAL_MS * 2);
    approve('approved');
    assert.equal(await running, 'approved');
    assert.deepEqual(shown, [{ stage: 'approving', slow: false }], 'something showed after the button left');
    assert.deepEqual(held, [true, false], 'the page was not let go');
  });
});

/* ------------------------------------------------------------------------ */
/* The words                                                                */
/* ------------------------------------------------------------------------ */

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

/** Every code file of the app itself (not its checks), relative to the kit. */
function appCodeFiles() {
  const found = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(KIT, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (CODE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith('.d.ts')) found.push(next);
    }
  };
  for (const folder of ['app', 'components', 'hooks', 'lib', 'scripts']) walk(folder);
  return found;
}

/** The two shapes Tellop's word check counts as a use: a lookup, and a refusal travelling as a key. */
function keysUsedIn(source) {
  const used = new Set();
  for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) used.add(match[1]);
  for (const match of source.matchAll(/['"](error\.[A-Za-z]+)['"]/g)) used.add(match[1]);
  return used;
}

test('every word is looked up by a key written out in the app’s code, and every key looked up exists', () => {
  const files = appCodeFiles();
  assert.ok(files.includes(path.join('app', 'wallet-panel.tsx')), 'the wallet panel was not found, so nothing was measured');
  const used = new Set();
  for (const file of files) for (const key of keysUsedIn(readFileSync(path.join(KIT, file), 'utf8'))) used.add(key);
  const defined = Object.keys(MESSAGES.en);
  assert.deepEqual([...used].filter((key) => !Object.hasOwn(MESSAGES.en, key)).sort(), []);
  assert.deepEqual(defined.filter((key) => !used.has(key)).sort(), []);
});

test('the check for written-out keys does catch a key nothing looks up', () => {
  // Without this, a check that could never fire would pass as well as one that works.
  const source = ["t('wallet.title', locale)", 'problemWords(reason, locale)', 'const key = `wallet.${name}`'].join('\n');
  assert.deepEqual([...keysUsedIn(source)], ['wallet.title']);
});

test('the wallet panel’s words are in both languages, translated, and use no word for how Stellar works inside', () => {
  const walletKeys = Object.keys(MESSAGES.en).filter((key) => key.startsWith('wallet.'));
  assert.ok(walletKeys.length >= 30, `only ${walletKeys.length} wallet words were found, so nothing was measured`);
  const inside = /\b(?:transactions?|xdr|soroban|stroops?|lumens?|contract calls?|ledgers?|horizon|friendbot|rpc|simulat\w*)\b|İşlem|işlem/i;
  for (const key of walletKeys) {
    for (const locale of LOCALES) {
      const words = MESSAGES[locale][key];
      assert.ok(typeof words === 'string' && words.trim().length > 0, `${locale} ${key} is missing`);
      assert.ok(!inside.test(words), `${locale} ${key}: ${words}`);
    }
    // The same placeholders in both languages, so a value handed in shows in each.
    const placeholders = (words) => [...words.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(placeholders(MESSAGES.tr[key]), placeholders(MESSAGES.en[key]), key);
  }
  const same = walletKeys.filter((key) => MESSAGES.tr[key] === MESSAGES.en[key]);
  assert.deepEqual(same, [], 'these read the same in Turkish as in English');
});
