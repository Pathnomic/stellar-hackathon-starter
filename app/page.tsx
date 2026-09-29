import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { listNotesPageFor } from '../lib/data/index.js';
import { PRIMARY_TEST_USER } from '../lib/data/test-users.js';
import { getLocale, t } from '../lib/i18n/index.js';
import { exampleFundraiser } from '../lib/stellar/example-data.ts';
import { loadDeployment, loadSettings } from '../lib/stellar/server.ts';

import { exampleFigures } from './fundraiser-view.ts';
import { LiveProgress } from './live-progress.tsx';
import { NoteForm } from './note-form.jsx';
import { ProgressFigures } from './progress-figures.tsx';
import { WalletPanel } from './wallet-panel.tsx';

/**
 * The starting page: a fundraiser on Stellar's test network, and below it the
 * notes the rest of this app is built on.
 *
 * `data-tellop-app-marker` is what Tellop's health probe looks for: a page that
 * renders it has really mounted, which is the difference between "ready" and the
 * white-screen state. Keep it on the outermost
 * element of the first page.
 *
 * The fundraiser. Its story is example content (`lib/stellar/example-data.ts`).
 * Its numbers depend on whether it has been published: Tellop writes
 * `stellar/deployment.json` when the person publishes it, so this page reads
 * that file on every request (never imports it: it is not there until then).
 * Until it is there, the numbers are an example, labelled as one; after, they
 * are read from Stellar's test network by the browser (`live-progress.tsx`).
 * Nothing on this page asks the network for anything before that.
 *
 * The notes read through `lib/data/` and name an owner, like every read in this
 * app, and `note-form.jsx` stays reached from this page.
 *
 * Every piece here comes from the component kit under `components/ui/`, which
 * names no colour, corner or face of its own: they are written in the names
 * `app/tokens.css` and `app/fonts.css` define, so changing the look changes them
 * and nothing here has to be touched.
 */
export const dynamic = 'force-dynamic';

type NotesPage = {
  readonly notes: readonly { readonly id: number; readonly body: string }[];
  readonly nextCursor: number | null;
};

/**
 * `listNotesPageFor` as it really behaves. It is JavaScript, and TypeScript reads
 * its `cursor = null` as "only ever null", so this says what it takes and
 * answers: an owner, and a note to page back from or `null`.
 */
const listNotesPage = listNotesPageFor as (ownerId: string, cursor: number | null) => Promise<NotesPage>;

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = getLocale();
  const owner = PRIMARY_TEST_USER;
  const before = (await searchParams)?.before;
  const cursor = typeof before === 'string' && /^[1-9][0-9]*$/u.test(before) && Number.isSafeInteger(Number(before)) ? Number(before) : null;
  const [{ notes, nextCursor }, deployment, settings] = await Promise.all([
    listNotesPage(owner.id, cursor),
    loadDeployment(),
    loadSettings(),
  ]);
  const contractId = deployment.published ? deployment.contractId : null;
  const example = exampleFundraiser(locale);

  return (
    <main className="starting-page" data-tellop-app-marker="ok">
      <h1>{t('app.title', locale)}</h1>
      <p className="tagline">{t('app.tagline', locale)}</p>

      <section aria-labelledby="fundraiser-title" className="mt-9 flex flex-col gap-6">
        <header className="flex flex-col items-start gap-3">
          <Badge variant="outline">{t('stellar.testNetwork', locale)}</Badge>
          <h2 className="m-0 text-2xl" id="fundraiser-title">
            {example.title}
          </h2>
          <p className="m-0">{example.story}</p>
          <p className="m-0 text-sm text-muted-foreground">{t('stellar.testMoneyOnly', locale)}</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{t('fundraiser.progressTitle', locale)}</CardTitle>
            <CardAction>
              <Badge variant={contractId === null ? 'secondary' : 'default'}>
                {contractId === null ? t('fundraiser.exampleBadge', locale) : t('fundraiser.publishedBadge', locale)}
              </Badge>
            </CardAction>
            <CardDescription>
              {contractId === null ? t('fundraiser.exampleNote', locale) : t('fundraiser.publishedNote', locale)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {contractId === null ? (
              <ProgressFigures figures={exampleFigures(settings, locale)} locale={locale} />
            ) : (
              <LiveProgress contractId={contractId} locale={locale} />
            )}
          </CardContent>
        </Card>

        <WalletPanel contractId={contractId} locale={locale} />

        <Card>
          <CardHeader>
            <CardTitle>{t('fundraiser.updatesTitle', locale)}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {example.updates.map((update) => (
                <li className="flex flex-col gap-0.5" key={update.when}>
                  <span className="text-xs text-muted-foreground">{update.when}</span>
                  <span>{update.text}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      <Card className="mt-9">
        <CardHeader>
          <CardTitle>{t('notes.headingFor', locale, { name: owner.name })}</CardTitle>
          <CardAction>
            <span className="badge">{t('sample.badge', locale)}</span>
          </CardAction>
        </CardHeader>
        <CardContent>
          {notes.length === 0 ? (
            <p className="empty">{t('notes.empty', locale)}</p>
          ) : (
            <ul className="notes">
              {notes.map((note) => (
                <li key={note.id}>{note.body}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {nextCursor !== null ? <a href={`/?before=${nextCursor}`}>{t('notes.older', locale)}</a> : null}

      <NoteForm locale={locale} ownerId={owner.id} />

      <p className="notice">{t('sample.notice', locale)}</p>
    </main>
  );
}
