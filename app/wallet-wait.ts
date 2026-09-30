/**
 * The wait while a wallet button's work is underway, and what it shows.
 *
 * A change goes through three steps (`wallet-actions.tsx`): getting it ready,
 * approving it in Freighter, sending it. Getting it ready takes about a second;
 * the long wait is Freighter opening its window for the approval, which can
 * take several seconds and may open behind the page. Connecting the wallet
 * waits on that window too, and getting test money waits on the test network
 * (`wallet-panel.tsx`). So while a button works, it shows a working mark and
 * its busy words; while Freighter is awaited, a line under it says Freighter
 * is opening, and after {@link SLOW_APPROVAL_MS} a second line says where to
 * find it.
 *
 * {@link waitView} decides what shows, and is pure. {@link followChange} holds
 * the one timer: every step change clears it, and so does the button leaving
 * the page, so the second line never outlives the wait it is about.
 * {@link watchChanges} runs a button's work through them, and ends the wait
 * however the work ends.
 */

import { t } from '../lib/i18n/index.js';
import type { Locale } from '../lib/i18n/index.js';

/** What a button is waiting on: one of a change's three steps, the wallet connecting, or test money arriving. */
export type ChangeStage = 'preparing' | 'approving' | 'sending' | 'connecting' | 'funding';

/** A wait underway: its step, and whether Freighter has been awaited long enough to say where it is. */
export type ChangeWait = { readonly stage: ChangeStage; readonly slow: boolean };

/** How long Freighter's window may take to appear before the page says where to find it. */
export const SLOW_APPROVAL_MS = 10_000;

/** The steps that wait on Freighter's own window: approving a change, and connecting the wallet. */
const IN_FREIGHTER: ReadonlySet<ChangeStage> = new Set<ChangeStage>(['approving', 'connecting']);

/** What a button shows of its wait: nothing at rest. */
export type WaitView = {
  /** The working mark on the button, while it works. */
  readonly working: boolean;
  /** The step in words, shown on the button in place of its own words; `null` at rest. */
  readonly step: string | null;
  /** The lines under the button, only while Freighter is awaited. */
  readonly lines: readonly string[];
};

const AT_REST: WaitView = Object.freeze({ working: false, step: null, lines: Object.freeze([]) });

function stepWords(stage: ChangeStage, locale: Locale): string {
  switch (stage) {
    case 'preparing':
      return t('wallet.stepPreparing', locale);
    case 'approving':
      return t('wallet.stepApprove', locale);
    case 'sending':
      return t('wallet.stepSending', locale);
    case 'connecting':
      return t('wallet.connecting', locale);
    case 'funding':
      return t('wallet.gettingTestMoney', locale);
  }
}

/** What a button shows for `wait`, the wait it has underway (`null`: none). */
export function waitView(wait: ChangeWait | null, locale: Locale): WaitView {
  if (wait === null) return AT_REST;
  const lines = !IN_FREIGHTER.has(wait.stage)
    ? []
    : wait.slow
      ? [t('wallet.freighterOpening', locale), t('wallet.freighterWhere', locale)]
      : [t('wallet.freighterOpening', locale)];
  return Object.freeze({ working: true, step: stepWords(wait.stage, locale), lines: Object.freeze(lines) });
}

/** Moves one button's wait from step to step; see {@link followChange}. */
export type ChangeFollower = {
  /** The wait is now on `stage`, or has ended (`null`). */
  readonly moveTo: (stage: ChangeStage | null) => void;
  /** The button has left the page: its timer is cleared, and later steps show nothing. */
  readonly stop: () => void;
};

/**
 * Follows one button's wait and hands `show` what to draw: each step as the
 * work reaches it, and a step in Freighter again, marked slow, once Freighter
 * has been awaited for {@link SLOW_APPROVAL_MS}. Every step change clears the
 * timer, and so does `stop`.
 */
export function followChange(show: (wait: ChangeWait | null) => void): ChangeFollower {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return Object.freeze({
    moveTo(stage: ChangeStage | null) {
      if (stopped) return;
      clear();
      show(stage === null ? null : { stage, slow: false });
      if (stage !== null && IN_FREIGHTER.has(stage)) {
        timer = setTimeout(() => {
          timer = null;
          show({ stage, slow: true });
        }, SLOW_APPROVAL_MS);
      }
    },
    stop() {
      stopped = true;
      clear();
    },
  });
}

/** A button's work: it reports each step it reaches through `onStage`, and answers when it is done. */
export type Change<T> = (onStage: (stage: ChangeStage) => void) => Promise<T>;

/** One button's work while the button is on the page; see {@link watchChanges}. */
export type ChangeWatch = {
  /**
   * Runs `change`, showing each step it reports, with `onBusy` held for the
   * whole run. The wait always ends, at rest and not busy, whether the work
   * went through, was declined or failed; a failure still reaches the caller.
   */
  readonly run: <T>(change: Change<T>, onBusy?: (busy: boolean) => void) => Promise<T>;
  /** The button is on the page: its steps show from now on. */
  readonly start: () => void;
  /** The button has left the page: its timer is cleared, and work still running shows nothing more. */
  readonly stop: () => void;
};

const NOTHING_HELD = (): void => {};

/**
 * Runs one button's work and hands `show` what to draw, through a
 * {@link followChange} that lives while the button is on the page: `start` as
 * it arrives, `stop` as it leaves. React's strict mode, on while an app is
 * being made, takes a new button off the page and puts it back once, so
 * `start` after `stop` follows afresh.
 */
export function watchChanges(show: (wait: ChangeWait | null) => void): ChangeWatch {
  let follower: ChangeFollower | null = null;
  return Object.freeze({
    async run<T>(change: Change<T>, onBusy: (busy: boolean) => void = NOTHING_HELD): Promise<T> {
      const following = follower;
      onBusy(true);
      try {
        return await change((stage) => following?.moveTo(stage));
      } finally {
        following?.moveTo(null);
        onBusy(false);
      }
    },
    start() {
      follower?.stop();
      follower = followChange(show);
    },
    stop() {
      follower?.stop();
      follower = null;
    },
  });
}
