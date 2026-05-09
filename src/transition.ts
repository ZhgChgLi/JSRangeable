/**
 * Kind of a boundary event.
 */
export type TransitionKind = "open" | "close";

/**
 * A single boundary event in coordinate-sorted order.
 *
 * ``coordinate`` is normally a finite number; it is ``null`` for close
 * events whose underlying interval ends at the implementation's +∞
 * sentinel (RFC §4.7 C4). Comparison treats ``null`` as greater than
 * any finite number.
 */
export class TransitionEvent<E> {
  readonly coordinate: number | null;
  readonly kind: TransitionKind;
  readonly element: E;

  constructor(coordinate: number | null, kind: TransitionKind, element: E) {
    this.coordinate = coordinate;
    this.kind = kind;
    this.element = element;
    Object.freeze(this);
  }
}
