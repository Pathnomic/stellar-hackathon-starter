import { addNoteFor, DataError, listNotesPageFor, removeNoteFor } from '../../../lib/data/index.js';

/**
 * Notes, read and saved.
 *
 * **Sharing with other websites is off, and it is off by omission.** No response
 * here carries `Access-Control-Allow-Origin`, so a browser refuses to hand this
 * app's answers to a page on another site. `AGENTS.md` rule 3 forbids adding
 * one, `OPTIONS` answers no preflight at all, and Tellop's conformance suite
 * fails if any such header appears. A `*` here would let any website on the
 * internet read whatever the person using this app can read.
 *
 * Every read names an owner. There is no address that returns everyone's notes,
 * which is what the cross-user access probe in the publish security gate checks.
 *
 * Refusals travel as message KEYS, never as sentences: the words are chosen in
 * the reader's language where they are displayed.
 */
export const dynamic = 'force-dynamic';

/**
 * @param {unknown} body
 * @param {number} status
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** @param {unknown} error */
function refusal(error) {
  if (error instanceof DataError) return json({ problem: error.messageKey }, error.messageKey === 'error.saveUnconfirmed' ? 503 : 400);
  return json({ problem: 'error.saveFailed' }, 500);
}

/** @param {Request} request */
export async function GET(request) {
  const address = new URL(request.url);
  const owner = address.searchParams.get('owner');
  const before = address.searchParams.get('before');
  try {
    const cursor = before === null ? null : Number(before);
    if (before !== null && (!/^[1-9][0-9]*$/u.test(before) || !Number.isSafeInteger(cursor))) throw new DataError('error.notFound');
    return json(await listNotesPageFor(owner, cursor));
  } catch (error) {
    return refusal(error);
  }
}

/** @param {Request} request */
export async function POST(request) {
  /** @type {unknown} */
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ problem: 'error.textMissing' }, 400);
  }
  const body = /** @type {{ owner?: unknown, text?: unknown }} */ (payload ?? {});
  try {
    return json({ note: await addNoteFor(body.owner, body.text) }, 201);
  } catch (error) {
    return refusal(error);
  }
}

/** @param {Request} request */
export async function DELETE(request) {
  let payload;
  try { payload = await request.json(); }
  catch { return json({ problem: 'error.notFound' }, 400); }
  const body = /** @type {{ owner?: unknown, id?: unknown }} */ (payload ?? {});
  try { return json({ removed: await removeNoteFor(body.owner, body.id) }); }
  catch (error) { return refusal(error); }
}

/**
 * No cross-origin preflight is answered. Same-origin requests never send one,
 * so this costs the app nothing and closes the door explicitly.
 */
export function OPTIONS() {
  return new Response(null, { status: 405, headers: { allow: 'GET, POST, DELETE' } });
}
