/**
 * The example fundraiser the starting page shows, until this app tells its own
 * story.
 *
 * The words live in `lib/i18n/locales/` like every other sentence, so the
 * example reads in the project's language; only the numbers live here. When the
 * app becomes the person's own, replace the words behind these keys (or the
 * keys themselves) with their story and their updates.
 *
 * The goal the page shows comes from `stellar/fundraiser.settings.json`, which
 * is what publishing will set up; {@link EXAMPLE_GOAL} is used only while that
 * file cannot be read. Once the fundraiser is published, every number comes
 * from Stellar's test network instead and none of these are shown.
 *
 * This is static example content, never stored and never sent anywhere.
 */

import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';

/** One dated line of news about the fundraiser. */
export type ExampleUpdate = {
  /** When it happened, as words ("Week 1"). */
  readonly when: string;
  readonly text: string;
};

export type ExampleFundraiser = {
  readonly title: string;
  /** One paragraph: what the money is for and why it matters. */
  readonly story: string;
  readonly updates: readonly ExampleUpdate[];
};

/** The example's goal, in test money, for when the settings file cannot be read. */
export const EXAMPLE_GOAL = '1000';

/** How much of its goal the example shows as raised: a whole percent, 0 to 100. */
export const EXAMPLE_RAISED_PERCENT = 42;

/** The example fundraiser's title, story and updates, in `locale`. */
export function exampleFundraiser(locale: Locale): ExampleFundraiser {
  return Object.freeze({
    title: t('example.title', locale),
    story: t('example.story', locale),
    updates: Object.freeze([
      Object.freeze({ when: t('example.updateOneWhen', locale), text: t('example.updateOne', locale) }),
      Object.freeze({ when: t('example.updateTwoWhen', locale), text: t('example.updateTwo', locale) }),
      Object.freeze({ when: t('example.updateThreeWhen', locale), text: t('example.updateThree', locale) }),
    ]),
  });
}
