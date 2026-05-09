import { InvalidIntervalError } from "./errors.js";

/**
 * Immutable closed integer interval [lo, hi].
 *
 * Both ends are inclusive, matching RFC §4.1. ``lo > hi`` throws
 * :class:`InvalidIntervalError` at construction time.
 */
export class Interval {
  readonly lo: number;
  readonly hi: number;

  constructor(lo: number, hi: number) {
    if (lo > hi) {
      throw new InvalidIntervalError(`lo (${lo}) > hi (${hi})`);
    }
    this.lo = lo;
    this.hi = hi;
    Object.freeze(this);
  }

  contains(coord: number): boolean {
    return this.lo <= coord && coord <= this.hi;
  }

  toTuple(): readonly [number, number] {
    return [this.lo, this.hi];
  }
}
