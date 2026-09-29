import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { readFundraiser } from '../lib/stellar/fundraiser.ts';
import type { FundraiserReading } from '../lib/stellar/fundraiser.ts';

/**
 * The published fundraiser as last read, shared by every piece of the page that
 * shows it: the progress card (`live-progress.tsx`) and the wallet panel
 * (`wallet-panel.tsx`).
 *
 * One reading for the whole page. The pieces that mount together while the
 * page loads share one read (seven questions to the network), and so do the
 * two mounts React makes on purpose while the app is being built. After the
 * person donates, collects or takes money back, the panel asks for a fresh
 * reading and every piece shows it: the old numbers stay on screen until the
 * new ones arrive.
 *
 * Nothing is read on the server: the first paint, there and in the browser
 * alike, is "being read", so the two always match. A problem is an answer like
 * any other, never an error in the console.
 */

type Shelf = {
  reading: FundraiserReading | null;
  underway: boolean;
  /** Read again once the reading underway ends: it may have started before a change. */
  again: boolean;
  readonly listeners: Set<() => void>;
};

const shelves = new Map<string, Shelf>();

function shelfFor(contractId: string): Shelf {
  let shelf = shelves.get(contractId);
  if (shelf === undefined) {
    shelf = { reading: null, underway: false, again: false, listeners: new Set() };
    shelves.set(contractId, shelf);
  }
  return shelf;
}

function tell(shelf: Shelf): void {
  for (const listener of [...shelf.listeners]) listener();
}

function startReading(contractId: string): void {
  const shelf = shelfFor(contractId);
  shelf.underway = true;
  void readFundraiser(contractId)
    .catch((): FundraiserReading => ({ ok: false, reason: 'unexpected-answer' }))
    .then((answer) => {
      shelf.underway = false;
      shelf.reading = answer;
      tell(shelf);
      if (shelf.again) {
        shelf.again = false;
        startReading(contractId);
      }
    });
}

/** Reads the fundraiser unless a reading is already underway, which is shared instead. */
function readOrJoin(contractId: string): void {
  if (!shelfFor(contractId).underway) startReading(contractId);
}

/** Reads the fundraiser afresh: after the reading underway, if there is one. */
function readAfresh(contractId: string): void {
  const shelf = shelfFor(contractId);
  if (shelf.underway) shelf.again = true;
  else startReading(contractId);
}

const nothingToWatch = () => () => {};

export type SharedReading = {
  /** The fundraiser as last read; `null` while the first reading is underway, or with nothing published. */
  readonly reading: FundraiserReading | null;
  /** Read again after a change the person made, keeping the last numbers on screen meanwhile. */
  readonly refresh: () => void;
  /** Read again after a problem, showing "being read" meanwhile. */
  readonly retry: () => void;
};

/**
 * The published fundraiser `contractId`, read once when the piece mounts
 * (shared with any other piece reading it at the same time). `null` for a
 * fundraiser that is not published: nothing is read at all then.
 */
export function useFundraiserReading(contractId: string | null): SharedReading {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (contractId === null) return nothingToWatch();
      const shelf = shelfFor(contractId);
      shelf.listeners.add(listener);
      return () => {
        shelf.listeners.delete(listener);
      };
    },
    [contractId],
  );
  const reading = useSyncExternalStore(
    subscribe,
    () => (contractId === null ? null : shelfFor(contractId).reading),
    () => null,
  );

  useEffect(() => {
    if (contractId !== null) readOrJoin(contractId);
  }, [contractId]);

  const refresh = useCallback(() => {
    if (contractId !== null) readAfresh(contractId);
  }, [contractId]);

  const retry = useCallback(() => {
    if (contractId === null) return;
    const shelf = shelfFor(contractId);
    shelf.reading = null;
    tell(shelf);
    readOrJoin(contractId);
  }, [contractId]);

  return { reading, refresh, retry };
}
