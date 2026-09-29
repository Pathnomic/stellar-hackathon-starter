/**
 * Reading this app's fundraiser files from disk. **Server code only** (a server
 * component, a route handler, a check): it uses Node's file system, so a page
 * that runs in the browser must never import it, and `index.ts` does not
 * re-export it.
 *
 * `stellar/deployment.json` appears when the person publishes from Tellop, so a
 * page that shows it should read it on each request (for example with
 * `export const dynamic = 'force-dynamic'` on the page) rather than import it:
 * an import of a file that is not there yet stops the app from building.
 */

/// <reference types="node" />
// (TypeScript 6 no longer loads Node's types by itself; this file is the one that needs them.)

import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEPLOYMENT_FILE,
  MAX_FILE_BYTES,
  SETTINGS_FILE,
  readDeploymentText,
  readSettingsText,
} from './deployment.ts';
import type { DeploymentReading, SettingsReading } from './deployment.ts';

type FileText = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'missing' } | { readonly kind: 'too-large' };

async function readSmallFile(file: string): Promise<FileText> {
  try {
    const info = await lstat(file);
    if (!info.isFile()) return { kind: 'missing' };
    if (info.size > MAX_FILE_BYTES) return { kind: 'too-large' };
    return { kind: 'text', text: await readFile(file, 'utf8') };
  } catch {
    return { kind: 'missing' };
  }
}

/** `stellar/deployment.json` under `projectRoot` (the folder the app runs from), checked. */
export async function loadDeployment(projectRoot: string = process.cwd()): Promise<DeploymentReading> {
  const file = await readSmallFile(path.join(projectRoot, DEPLOYMENT_FILE));
  if (file.kind === 'too-large') return { published: false, reason: 'too-large' };
  return readDeploymentText(file.kind === 'text' ? file.text : null);
}

/** `stellar/fundraiser.settings.json` under `projectRoot`, checked against `now`. */
export async function loadSettings(projectRoot: string = process.cwd(), now: Date = new Date()): Promise<SettingsReading> {
  const file = await readSmallFile(path.join(projectRoot, SETTINGS_FILE));
  if (file.kind === 'too-large') return { ok: false, reason: 'too-large' };
  return readSettingsText(file.kind === 'text' ? file.text : null, now);
}
