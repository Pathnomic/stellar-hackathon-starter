/**
 * What `spinner.jsx` takes, for screens written in TypeScript.
 *
 * The kit's pieces are JavaScript, and TypeScript works out a JavaScript
 * piece's properties from the way it takes them apart, so it believes
 * `className` is required. This file says what the piece really takes: an
 * `svg`'s own properties, since it draws an icon. It describes the piece and
 * changes nothing in it.
 *
 * The piece announces itself as a status saying "Loading", in English. Beside
 * words that already say what is happening, pass `aria-hidden="true"` and set
 * `role` and `aria-label` to `undefined`.
 */

import type { ComponentProps, JSX } from 'react';

export declare function Spinner(props: ComponentProps<'svg'>): JSX.Element;
