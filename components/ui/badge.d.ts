/**
 * What `badge.jsx` takes, for screens written in TypeScript.
 *
 * The kit's pieces are JavaScript, and TypeScript works out a JavaScript
 * piece's properties from the way it takes them apart, so it believes
 * `className` and `render` are required. This file says what the piece really
 * takes: a `span`'s own properties, one of its six looks, and optionally
 * another element to draw it as (Base UI's `render`). It describes the piece
 * and changes nothing in it.
 */

import type { ComponentProps, JSX, ReactElement } from 'react';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';

/** Draw the badge as another element: that element, or a function that returns one. */
type RenderAs = ReactElement | ((props: Record<string, unknown>, state: Record<string, unknown>) => ReactElement);

export declare const badgeVariants: (options?: {
  readonly variant?: BadgeVariant | null;
  readonly className?: string;
}) => string;

export declare function Badge(
  props: ComponentProps<'span'> & {
    readonly variant?: BadgeVariant;
    readonly render?: RenderAs;
  },
): JSX.Element;
