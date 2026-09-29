/**
 * What `field.jsx` takes, for screens written in TypeScript.
 *
 * The kit's pieces are JavaScript, and TypeScript works out a JavaScript
 * piece's properties from the way it takes them apart, so it believes
 * `className` is required and a screen that leaves it out does not compile.
 * This file says what each piece really takes: the properties of the element
 * it draws, every one optional, and the few it adds. It describes the pieces
 * and changes nothing in them.
 */

import type { ComponentProps, JSX, ReactNode } from 'react';

type DivProps = ComponentProps<'div'>;

export declare function Field(
  props: DivProps & { readonly orientation?: 'vertical' | 'horizontal' | 'responsive' },
): JSX.Element;
export declare function FieldLabel(props: ComponentProps<'label'>): JSX.Element;
export declare function FieldDescription(props: ComponentProps<'p'>): JSX.Element;
/** Draws `children`, or else the messages in `errors`; draws nothing when there are neither. */
export declare function FieldError(
  props: Omit<DivProps, 'children'> & {
    readonly children?: ReactNode;
    readonly errors?: readonly ({ readonly message?: string } | undefined)[];
  },
): JSX.Element | null;
export declare function FieldGroup(props: DivProps): JSX.Element;
export declare function FieldLegend(
  props: ComponentProps<'legend'> & { readonly variant?: 'legend' | 'label' },
): JSX.Element;
export declare function FieldSeparator(props: DivProps): JSX.Element;
export declare function FieldSet(props: ComponentProps<'fieldset'>): JSX.Element;
export declare function FieldContent(props: DivProps): JSX.Element;
export declare function FieldTitle(props: DivProps): JSX.Element;
