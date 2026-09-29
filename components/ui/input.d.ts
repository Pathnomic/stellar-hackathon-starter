/**
 * What `input.jsx` takes, for screens written in TypeScript.
 *
 * The kit's pieces are JavaScript, and TypeScript works out a JavaScript
 * piece's properties from the way it takes them apart, so it believes
 * `className` and `type` are required. This file says what the piece really
 * takes: an `input`'s own properties, every one optional, and the one Base UI
 * adds. It describes the piece and changes nothing in it.
 */

import type { ComponentProps, JSX } from 'react';

export declare function Input(
  props: ComponentProps<'input'> & {
    /** Base UI: called with the field's new text whenever it changes. */
    readonly onValueChange?: (value: string, details: unknown) => void;
  },
): JSX.Element;
