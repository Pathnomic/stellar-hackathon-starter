/**
 * What `button.jsx` takes, for screens written in TypeScript.
 *
 * The kit's pieces are JavaScript, and TypeScript works out a JavaScript
 * piece's properties from the way it takes them apart, so it believes
 * `className` is required. This file says what the piece really takes: a
 * `button`'s own properties, one of its looks and sizes, and the few Base UI
 * adds. It describes the piece and changes nothing in it.
 */

import type { ComponentProps, JSX, ReactElement } from 'react';

export type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';

export type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';

/** Draw the button as another element: that element, or a function that returns one. */
type RenderAs = ReactElement | ((props: Record<string, unknown>, state: Record<string, unknown>) => ReactElement);

export declare const buttonVariants: (options?: {
  readonly variant?: ButtonVariant | null;
  readonly size?: ButtonSize | null;
  readonly className?: string;
}) => string;

export declare function Button(
  props: ComponentProps<'button'> & {
    readonly variant?: ButtonVariant;
    readonly size?: ButtonSize;
    /** Base UI: draw the button as another element, for example a link. */
    readonly render?: RenderAs;
    /** Base UI: whether what `render` draws is a real `<button>` (it is unless told otherwise). */
    readonly nativeButton?: boolean;
    /** Base UI: keep the button reachable with the keyboard while it is disabled. */
    readonly focusableWhenDisabled?: boolean;
  },
): JSX.Element;
