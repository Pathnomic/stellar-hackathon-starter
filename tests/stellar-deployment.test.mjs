/**
 * The fundraiser's two files, checked.
 *
 * `stellar/deployment.json` is Tellop's record of the published contract. Only
 * its exact shape counts as published: the test network, a valid contract
 * address, a valid account address, 64-character hashes, a real UTC time, and
 * not one key more or less. Anything else - including no file at all - is "not
 * published yet", with the reason.
 *
 * `stellar/fundraiser.settings.json` may be edited, so its checks are the ones a
 * careless edit meets: the goal, the end date (ahead, at most 90 days) and the
 * beneficiary, and no extra keys. Both are also read from real files on disk,
 * in a temporary folder removed afterwards. Nothing here reaches the network.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  DEPLOYMENT_FILE,
  MAX_FILE_BYTES,
  SETTINGS_FILE,
  SETTINGS_LIMITS,
  parseDeployment,
  parseSettings,
  readDeploymentText,
  readSettingsText,
} from '../lib/stellar/deployment.ts';
import { loadDeployment, loadSettings } from '../lib/stellar/server.ts';
import { CONTRACT_ID, FRIEND, WALLET } from './fixtures/stellar/fake-network.mjs';

const UPLOAD = '5c5b0f1ea6e1d07bb5b3f3b1f0c3a0e8c5a6d7a1b2c3d4e5f60718293a4b5c6d';
const CREATE = '0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e';
const WASM = 'd1a3c1a2e4b5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9';

function deployment(overrides = {}) {
  return {
    network: 'testnet',
    contractId: CONTRACT_ID,
    accountAddress: WALLET.publicKey(),
    wasmSha256: WASM,
    publishedAt: '2026-09-30T14:05:09.123Z',
    transactions: { upload: UPLOAD, create: CREATE },
    ...overrides,
  };
}

test('the exact shape Tellop writes is a published fundraiser', () => {
  assert.deepEqual(parseDeployment(deployment()), { published: true, ...deployment() });
  assert.equal(parseDeployment(deployment({ publishedAt: '2026-09-30T14:05:09Z' })).published, true);
  assert.equal(readDeploymentText(JSON.stringify(deployment())).published, true);
});

test('no file, or not a file of this shape, is "not published yet", with the reason', () => {
  const { transactions, ...withoutTransactions } = deployment();
  const cases = [
    [readDeploymentText(null), 'missing'],
    [readDeploymentText(undefined), 'missing'],
    [readDeploymentText('{"network": "testnet",'), 'not-json'],
    [readDeploymentText(' '.repeat(MAX_FILE_BYTES + 1)), 'too-large'],
    [parseDeployment([deployment()]), 'not-an-object'],
    [parseDeployment('testnet'), 'not-an-object'],
    [parseDeployment(null), 'not-an-object'],
    [parseDeployment(deployment({ extra: true })), 'unexpected-keys'],
    [parseDeployment(withoutTransactions), 'missing-keys'],
    [parseDeployment(deployment({ network: 'mainnet' })), 'wrong-network'],
    [parseDeployment(deployment({ network: 'public' })), 'wrong-network'],
    [parseDeployment(deployment({ network: 'TESTNET' })), 'wrong-network'],
    [parseDeployment(deployment({ contractId: WALLET.publicKey() })), 'bad-contract-id'],
    [parseDeployment(deployment({ contractId: CONTRACT_ID.toLowerCase() })), 'bad-contract-id'],
    [parseDeployment(deployment({ contractId: `${CONTRACT_ID.slice(0, -1)}A` })), 'bad-contract-id'],
    [parseDeployment(deployment({ accountAddress: CONTRACT_ID })), 'bad-account-address'],
    [parseDeployment(deployment({ accountAddress: WALLET.publicKey().toLowerCase() })), 'bad-account-address'],
    [parseDeployment(deployment({ wasmSha256: WASM.toUpperCase() })), 'bad-wasm-hash'],
    [parseDeployment(deployment({ wasmSha256: WASM.slice(2) })), 'bad-wasm-hash'],
    [parseDeployment(deployment({ publishedAt: 'yesterday' })), 'bad-published-at'],
    [parseDeployment(deployment({ publishedAt: '2026-02-30T10:00:00Z' })), 'bad-published-at'],
    [parseDeployment(deployment({ publishedAt: '2026-09-30 14:05:09' })), 'bad-published-at'],
    [parseDeployment(deployment({ publishedAt: 1790000000 })), 'bad-published-at'],
    [parseDeployment(deployment({ transactions: { upload: UPLOAD } })), 'bad-transactions'],
    [parseDeployment(deployment({ transactions: { upload: UPLOAD, create: CREATE, extra: CREATE } })), 'bad-transactions'],
    [parseDeployment(deployment({ transactions: { upload: UPLOAD, create: 'pending' } })), 'bad-transactions'],
    [parseDeployment(deployment({ transactions: [UPLOAD, CREATE] })), 'bad-transactions'],
  ];
  for (const [reading, reason] of cases) assert.deepEqual(reading, { published: false, reason });
});

const NOW = new Date('2026-09-28T12:00:00Z');

test('settings of the exact shape are read, with the end as a UTC moment and in seconds', () => {
  assert.deepEqual(parseSettings({ goal: 250, endsAt: '2026-10-15', beneficiary: 'app-account' }, NOW), {
    ok: true,
    goal: 250,
    endsAt: '2026-10-16T00:00:00.000Z',
    deadline: Date.UTC(2026, 9, 16) / 1000,
    beneficiary: 'app-account',
  });
  const moment = parseSettings({ goal: 0.5, endsAt: '2026-10-15T21:00+03:00', beneficiary: FRIEND.publicKey() }, NOW);
  assert.deepEqual(moment, {
    ok: true,
    goal: 0.5,
    endsAt: '2026-10-15T18:00:00.000Z',
    deadline: Date.UTC(2026, 9, 15, 18) / 1000,
    beneficiary: FRIEND.publicKey(),
  });
  assert.equal(readSettingsText('{"goal":1,"endsAt":"2026-12-26T23:59:59Z","beneficiary":"app-account"}', NOW).ok, true);
  assert.deepEqual({ ...SETTINGS_LIMITS }, { maxGoal: 1_000_000_000, maxDays: 90 });
});

test('a careless edit to the settings is refused, with the reason', () => {
  const good = { goal: 250, endsAt: '2026-10-15', beneficiary: 'app-account' };
  const cases = [
    [readSettingsText(null, NOW), 'missing'],
    [readSettingsText('goal: 250', NOW), 'not-json'],
    [readSettingsText(' '.repeat(MAX_FILE_BYTES + 1), NOW), 'too-large'],
    [parseSettings([good], NOW), 'not-an-object'],
    [parseSettings({ ...good, title: 'My fundraiser' }, NOW), 'unexpected-keys'],
    [parseSettings({ goal: 250, endsAt: '2026-10-15' }, NOW), 'missing-keys'],
    [parseSettings({ ...good, goal: 0 }, NOW), 'bad-goal'],
    [parseSettings({ ...good, goal: -5 }, NOW), 'bad-goal'],
    [parseSettings({ ...good, goal: '250' }, NOW), 'bad-goal'],
    [parseSettings({ ...good, goal: 0.12345678 }, NOW), 'bad-goal'],
    [parseSettings({ ...good, goal: Number.NaN }, NOW), 'bad-goal'],
    [parseSettings({ ...good, goal: 2_000_000_000 }, NOW), 'goal-too-large'],
    [parseSettings({ ...good, endsAt: '2026-09-27' }, NOW), 'ends-in-past'],
    [parseSettings({ ...good, endsAt: '2026-09-28T11:59:59Z' }, NOW), 'ends-in-past'],
    [parseSettings({ ...good, endsAt: '2027-01-15' }, NOW), 'ends-too-late'],
    [parseSettings({ ...good, endsAt: '2026-02-30' }, NOW), 'bad-end-date'],
    [parseSettings({ ...good, endsAt: '15/10/2026' }, NOW), 'bad-end-date'],
    [parseSettings({ ...good, endsAt: '2026-10-15T25:00Z' }, NOW), 'bad-end-date'],
    [parseSettings({ ...good, endsAt: '2026-10-15T10:00' }, NOW), 'bad-end-date'],
    [parseSettings({ ...good, endsAt: 1790000000 }, NOW), 'bad-end-date'],
    [parseSettings({ ...good, beneficiary: CONTRACT_ID }, NOW), 'bad-beneficiary'],
    [parseSettings({ ...good, beneficiary: FRIEND.publicKey().toLowerCase() }, NOW), 'bad-beneficiary'],
    [parseSettings({ ...good, beneficiary: 'me' }, NOW), 'bad-beneficiary'],
  ];
  for (const [reading, reason] of cases) assert.deepEqual(reading, { ok: false, reason });
});

/* The same checks, on real files. */

const scratch = mkdtempSync(path.join(os.tmpdir(), 'stellar-files-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

function project(name) {
  const root = path.join(scratch, name);
  mkdirSync(path.join(root, 'stellar'), { recursive: true });
  return root;
}

test('a project that has not published has no deployment file: "not published yet"', async () => {
  assert.equal(DEPLOYMENT_FILE, 'stellar/deployment.json');
  assert.deepEqual(await loadDeployment(project('fresh')), { published: false, reason: 'missing' });
  assert.deepEqual(await loadDeployment(path.join(scratch, 'no-such-folder')), { published: false, reason: 'missing' });
});

test('the deployment file on disk is read and checked like its contents', async () => {
  const root = project('published');
  writeFileSync(path.join(root, DEPLOYMENT_FILE), `${JSON.stringify(deployment(), null, 2)}\n`);
  assert.deepEqual(await loadDeployment(root), { published: true, ...deployment() });

  const broken = project('broken');
  writeFileSync(path.join(broken, DEPLOYMENT_FILE), '{ "network": "testnet"');
  assert.deepEqual(await loadDeployment(broken), { published: false, reason: 'not-json' });

  const folder = project('folder');
  mkdirSync(path.join(folder, DEPLOYMENT_FILE));
  assert.deepEqual(await loadDeployment(folder), { published: false, reason: 'missing' });

  const linked = project('linked');
  symlinkSync(path.join(root, DEPLOYMENT_FILE), path.join(linked, DEPLOYMENT_FILE));
  assert.deepEqual(await loadDeployment(linked), { published: false, reason: 'missing' });

  const huge = project('huge');
  writeFileSync(path.join(huge, DEPLOYMENT_FILE), ' '.repeat(MAX_FILE_BYTES + 1));
  assert.deepEqual(await loadDeployment(huge), { published: false, reason: 'too-large' });
});

test('the settings file on disk is read and checked like its contents', async () => {
  assert.equal(SETTINGS_FILE, 'stellar/fundraiser.settings.json');
  const root = project('settings');
  assert.deepEqual(await loadSettings(root, NOW), { ok: false, reason: 'missing' });
  writeFileSync(
    path.join(root, SETTINGS_FILE),
    `${JSON.stringify({ goal: 100, endsAt: '2026-11-01', beneficiary: 'app-account' }, null, 2)}\n`,
  );
  const reading = await loadSettings(root, NOW);
  assert.equal(reading.ok, true);
  assert.equal(reading.endsAt, '2026-11-02T00:00:00.000Z');
});
