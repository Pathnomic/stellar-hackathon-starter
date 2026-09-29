/**
 * What `progress.jsx` takes, for screens written in TypeScript.
 *
 * The kit's pieces are JavaScript, and TypeScript works out a JavaScript
 * piece's properties from the way it takes them apart, so it believes
 * `className` is required. This file says what each piece really takes: Base
 * UI's progress bar settings on the bar itself, and an element's own
 * properties on its parts. It describes the pieces and changes nothing in
 * them.
 *
 * Pass `locale` whenever the page has a language: without it the bar writes
 * its percentage in the language of whatever computer draws it, and the server
 * and the browser can disagree.
 */

import type { ComponentProps, JSX, ReactNode } from 'react';

export declare function Progress(
  props: Omit<ComponentProps<'div'>, 'children'> & {
    /** How far along, from `min` to `max` (0 to 100 unless told otherwise); `null` when unknown. */
    readonly value: number | null;
    readonly min?: number;
    readonly max?: number;
    /** The language the percentage is written in. */
    readonly locale?: Intl.LocalesArgument;
    readonly format?: Intl.NumberFormatOptions;
    readonly getAriaValueText?: (formattedValue: string, value: number | null) => string;
    readonly children?: ReactNode;
  },
): JSX.Element;

export declare function ProgressTrack(props: ComponentProps<'div'>): JSX.Element;
export declare function ProgressIndicator(props: ComponentProps<'div'>): JSX.Element;
export declare function ProgressLabel(props: ComponentProps<'span'>): JSX.Element;

export declare function ProgressValue(
  props: Omit<ComponentProps<'span'>, 'children'> & {
    readonly children?: ReactNode | ((formattedValue: string | null, value: number | null) => ReactNode);
  },
): JSX.Element;
