/**
 * One way to ask a Stellar service something over the web, used by
 * `horizon.ts` and `friendbot.ts`.
 *
 * Every request made here:
 *  - carries no cookies (`credentials: 'omit'`) and no address of the page it
 *    came from (`referrerPolicy: 'no-referrer'`);
 *  - adds no header of its own, so a read is a "simple" request a browser sends
 *    without asking the service first (a form-encoded send is one too);
 *  - follows no redirect, gives up after a bounded time, and reads at most
 *    {@link MAX_ANSWER_BYTES} of the answer;
 *  - never throws and never writes to the console: a service that cannot be
 *    reached is an answer (`unreachable`), not an error.
 *
 * `fetch` is looked up when a request is made, never kept, so a check can stand
 * in for the network.
 */

/** The largest answer read from a service. Stellar's answers here are a few kilobytes. */
export const MAX_ANSWER_BYTES = 1_000_000;

/** What came back: a status and the parsed JSON body (`undefined` when it was not JSON). */
export type HttpAnswer =
  | { readonly kind: 'answer'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'unreachable' };

export type HttpRequest = {
  readonly method: 'GET' | 'POST';
  /** Sent as `application/x-www-form-urlencoded`. */
  readonly form?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
};

/** Asks `url`; see the file's header for what every request promises. */
export async function requestJson(url: string, request: HttpRequest): Promise<HttpAnswer> {
  const init: RequestInit = {
    method: request.method,
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(request.timeoutMs),
  };
  if (request.form !== undefined) {
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    init.body = new URLSearchParams(request.form).toString();
  }
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, init);
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_ANSWER_BYTES) return { kind: 'unreachable' };
    text = await response.text();
  } catch {
    return { kind: 'unreachable' };
  }
  if (text.length > MAX_ANSWER_BYTES) return { kind: 'unreachable' };
  let body: unknown;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { kind: 'answer', status: response.status, body };
}

/** `base` and one more path, whatever `base` ends with. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Whether `value` is a plain object (not an array, not `null`). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
