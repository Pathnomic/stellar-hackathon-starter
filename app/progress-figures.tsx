import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';

import { t } from '../lib/i18n/index.js';
import type { Locale } from '../lib/i18n/index.js';

import type { FundraiserFigures } from './fundraiser-view.ts';

/**
 * The fundraiser's progress bar and its four figures: raised, goal, the last
 * day, and where it stands.
 *
 * Drawn the same way for the example (on the server) and for a published
 * fundraiser (in the browser, `live-progress.tsx`), so the two can never look
 * different. Every value arrives already in words (`fundraiser-view.ts`).
 *
 * The bar is told the page's language: left to itself it formats its
 * percentage in whatever language the computer running it prefers, and the
 * server and the browser can disagree about that.
 */
export function ProgressFigures({ figures, locale }: { readonly figures: FundraiserFigures; readonly locale: Locale }) {
  return (
    <div className="flex flex-col gap-4">
      <Progress value={figures.percent} locale={locale}>
        <ProgressLabel>{t('fundraiser.progressLabel', locale)}</ProgressLabel>
        <ProgressValue />
      </Progress>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
        <dt className="text-muted-foreground">{t('fundraiser.raised', locale)}</dt>
        <dd>{figures.raised}</dd>
        <dt className="text-muted-foreground">{t('fundraiser.goal', locale)}</dt>
        <dd>{figures.goal}</dd>
        {figures.endsOn === null ? null : (
          <>
            <dt className="text-muted-foreground">{t('fundraiser.endsOn', locale)}</dt>
            <dd>{figures.endsOn}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('fundraiser.status', locale)}</dt>
        <dd>{figures.status}</dd>
      </dl>
    </div>
  );
}
