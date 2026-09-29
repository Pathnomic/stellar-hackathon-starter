'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { t } from '../lib/i18n/index.js';

/**
 * The designated fault file.
 *
 * Tellop's conformance suites seed a syntax error by appending to THIS file, so
 * the fault is always in a browser-side piece reached from the first paint - the
 * case where the framework would render its own error screen if nobody stopped
 * it. Keep this file small, keep it reached from the starting page, and keep its
 * path stable: Tellop's template checks name it.
 *
 * Every word here comes from `lib/i18n`, including the refusal messages, which
 * arrive from the server as keys rather than as sentences.
 *
 * The typing box and the save control are both the kit's own, from `components/ui/`,
 * not bare elements: they take their colour, their corner and their face from
 * `app/tokens.css` and `app/fonts.css`, so approving a different look restyles them
 * with nothing here changing. Reach for a kit piece wherever one exists.
 */
export function NoteForm({ locale, ownerId }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problemKey, setProblemKey] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setProblemKey('');
    try {
      const response = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: ownerId, text }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setProblemKey(typeof payload.problem === 'string' ? payload.problem : 'error.saveUnconfirmed');
        return;
      }
      setText('');
      window.location.reload();
    } catch {
      setProblemKey('error.saveUnconfirmed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        {t('notes.fieldLabel', locale)}
        <Input
          disabled={busy}
          name="text"
          onChange={(event) => setText(event.target.value)}
          placeholder={t('notes.fieldPlaceholder', locale)}
          value={text}
        />
      </label>
      <Button disabled={busy} type="submit">
        {busy ? t('notes.saving', locale) : t('notes.saveAction', locale)}
      </Button>
      {problemKey === '' ? null : <p className="problem">{t(problemKey, locale)}</p>}
    </form>
  );
}
