/**
 * Wraps the ordered tuple of elements active at a coordinate.
 *
 * ``objs`` is sorted by first-insertion order ascending (RFC §4.5).
 * The same coordinate within an unmutated container always returns
 * an equivalent ``Slot``.
 */
export class Slot<E> {
  readonly objs: readonly E[];

  constructor(objs: readonly E[]) {
    this.objs = objs;
    Object.freeze(this);
  }

  get size(): number {
    return this.objs.length;
  }

  get empty(): boolean {
    return this.objs.length === 0;
  }

  [Symbol.iterator](): Iterator<E> {
    return this.objs[Symbol.iterator]();
  }
}
