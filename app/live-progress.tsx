'use client';

import { Button } from '@/components/ui/button';

import { t } from '../lib/i18n/index.js';
import type { Locale } from '../lib/i18n/index.js';

import { useFundraiserReading } from './fundraiser-reading.ts';
import { publishedFigures } from './fundraiser-view.ts';
import { ProgressFigures } from './progress-figures.tsx';
import { problemWords } from './stellar-problems.ts';

/**
 * A published fundraiser's progress, read from Stellar's test network.
 *
 * Shown only once `stellar/deployment.json` says the fundraiser is published
 * (the page decides that on the server), and read here, in the browser: this
 * app's server has no way out to the network, and the page does. It is the one
 * Stellar request this page makes while it loads, and the wallet panel shares
 * it rather than asking again (`fundraiser-reading.ts`). After a donation, a
 * payout or a refund, the panel asks for a fresh reading and the numbers here
 * follow.
 *
 * The first paint, on the server and in the browser alike, says the numbers are
 * being read, so the two always match. A problem is shown in words, with a way
 * to try again, and never written to the console.
 */
export function LiveProgress({ contractId, locale }: { readonly contractId: string; readonly locale: Locale }) {
  const { reading, retry } = useFundraiserReading(contractId);

  if (reading === null) {
    return (
      <p className="text-muted-foreground" role="status">
        {t('fundraiser.reading', locale)}
      </p>
    );
  }

  const figures = reading.ok ? publishedFigures(reading, locale) : null;
  if (figures !== null) return <ProgressFigures figures={figures} locale={locale} />;

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-destructive" role="alert">
        {problemWords(reading.ok ? 'unexpected-answer' : reading.reason, locale)}
      </p>
      <Button onClick={retry} variant="outline">
        {t('fundraiser.tryAgain', locale)}
      </Button>
    </div>
  );
}
