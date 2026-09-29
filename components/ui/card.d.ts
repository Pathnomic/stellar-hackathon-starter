/**
 * What `card.jsx` takes, for screens written in TypeScript.
 *
 * The kit's pieces are JavaScript, and TypeScript works out a JavaScript
 * piece's properties from the way it takes them apart, so it believes
 * `className` is required and a screen that leaves it out does not compile.
 * This file says what each piece really takes: a `div`'s own properties, every
 * one optional. It describes the piece and changes nothing in it; if the piece
 * ever changes what it takes, this file changes with it.
 */

import type { ComponentProps, JSX } from 'react';

type DivProps = ComponentProps<'div'>;

export declare function Card(props: DivProps & { readonly size?: 'default' | 'sm' }): JSX.Element;
export declare function CardHeader(props: DivProps): JSX.Element;
export declare function CardFooter(props: DivProps): JSX.Element;
export declare function CardTitle(props: DivProps): JSX.Element;
export declare function CardAction(props: DivProps): JSX.Element;
export declare function CardDescription(props: DivProps): JSX.Element;
export declare function CardContent(props: DivProps): JSX.Element;
