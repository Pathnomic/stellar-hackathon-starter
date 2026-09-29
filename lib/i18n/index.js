/**
 * Every word a person reads comes from here.
 *
 * Two rules, and a conformance check in Tellop's own suite enforces both:
 *
 *  1. No sentence is written directly into a component. A string that is not in
 *     `locales/` cannot be translated, and the app ships in Turkish and English
 *     from day one - not "English now, Turkish later".
 *  2. `en.json` and `tr.json` always carry exactly the same keys. A key present
 *     in one and missing from the other is how half an app silently reverts to
 *     the other language.
 *
 * The chosen language is a property of the project, decided once at ideation
 * (UX 4), so it arrives in the environment rather than being negotiated per
 * request. `NEXT_PUBLIC_` is required for the value to also be readable in the
 * browser half of the app; it holds a language code and nothing else.
 */

import en from './locales/en.json' with { type: 'json' };
import tr from './locales/tr.json' with { type: 'json' };

/** @typedef {'en' | 'tr'} Locale */

/** @type {readonly Locale[]} */
export const LOCALES = Object.freeze(['en', 'tr']);

/** @type {Locale} */
export const DEFAULT_LOCALE = 'en';

/** @type {Readonly<Record<Locale, Readonly<Record<string, string>>>>} */
export const MESSAGES = Object.freeze({ en: Object.freeze(en), tr: Object.freeze(tr) });

/**
 * The project's language, or English when nothing valid was chosen.
 *
 * Written as a full static expression so the browser half of the app gets the
 * value inlined at compile time.
 *
 * @returns {Locale}
 */
export function getLocale() {
  const chosen = process.env.NEXT_PUBLIC_APP_LANGUAGE;
  return chosen === 'tr' || chosen === 'en' ? chosen : DEFAULT_LOCALE;
}

/**
 * Look up a string, substituting `{name}`-style placeholders.
 *
 * A missing key returns the key itself rather than an empty string: a visible
 * `notes.heading` on screen is a bug somebody fixes, and a blank space is a bug
 * nobody notices.
 *
 * @param {string} key
 * @param {Locale} [locale]
 * @param {Readonly<Record<string, string>>} [values]
 * @returns {string}
 */
export function t(key, locale = DEFAULT_LOCALE, values = {}) {
  const table = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  const template = table[key] ?? MESSAGES[DEFAULT_LOCALE][key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(values, name) ? values[name] : whole,
  );
}
