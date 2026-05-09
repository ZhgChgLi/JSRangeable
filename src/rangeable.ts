import { BoundaryIndex } from "./boundaryIndex.js";
import { DisjointSet } from "./disjointSet.js";
import { InvalidIntervalError, RangeableError } from "./errors.js";
import { Interval } from "./interval.js";
import { Slot } from "./slot.js";
import type { TransitionEvent } from "./transition.js";

/** Constructor options for {@link Rangeable}. */
export interface RangeableOptions<E> {
  /**
   * Maps an element to a stable equivalence-class key. Two elements
   * with the same key are treated as the same logical element.
   * MUST be deterministic and stable across the lifetime of the
   * `Rangeable` instance.
   */
  keyFn: (element: E) => string | number;

  /**
   * Optional sentinel for the +∞ close-coordinate behavior (RFC §4.7
   * C4). When set and an interval's `hi === intMaxSentinel`, the close
   * event's coordinate is `null` (treated as +∞ in the total order).
   * Default is unset (no sentinel).
   */
  intMaxSentinel?: number;
}

/** Internal record per element key. */
interface ElementEntry<E> {
  element: E;
  set: DisjointSet;
  ord: number;
}

/**
 * Generic, integer-coordinate, closed-interval set container.
 *
 * Pairs hashable elements with their merged disjoint integer ranges
 * and supports three query families:
 *
 *   * by-element via {@link Rangeable.getRange}
 *   * by-position via {@link Rangeable.at}
 *   * by-range via {@link Rangeable.transitions}
 *
 * Element equality is defined by the user-provided `keyFn`.
 *
 * See [RFC §3](https://github.com/ZhgChgLi/RangeableRFC) for the full
 * normative API surface.
 */
export class Rangeable<E> {
  private readonly _keyFn: (element: E) => string | number;
  private readonly _intMaxSentinel: number | null;
  private readonly _byKey: Map<string | number, ElementEntry<E>> = new Map();
  private _version: number = 0;
  private _eventIndex: BoundaryIndex<E> | null = null;

  constructor(options: RangeableOptions<E>) {
    if (!options || typeof options.keyFn !== "function") {
      throw new TypeError("Rangeable: keyFn (element => string | number) is required");
    }
    this._keyFn = options.keyFn;
    this._intMaxSentinel = options.intMaxSentinel ?? null;
  }

  get version(): number {
    return this._version;
  }

  get size(): number {
    return this._byKey.size;
  }

  get empty(): boolean {
    return this._byKey.size === 0;
  }

  /**
   * Insert `element` covering the closed interval `[start, end]`.
   *
   * Idempotent per RFC §3.2: re-inserting a sub-range that is already
   * fully contained leaves the container unchanged and does NOT bump
   * `version`.
   *
   * Throws {@link InvalidIntervalError} if `start > end`.
   *
   * Returns `this` for chaining.
   */
  insert(element: E, range: { start: number; end: number }): this {
    const { start, end } = range;
    if (start > end) {
      throw new InvalidIntervalError(`start (${start}) > end (${end})`);
    }

    const key = this._keyFn(element);
    let entry = this._byKey.get(key);
    if (entry === undefined) {
      entry = {
        element,
        set: new DisjointSet(),
        ord: this._byKey.size + 1,
      };
      this._byKey.set(key, entry);
    }

    const result = entry.set.insert(start, end);
    if (result === "mutated") {
      this._version += 1;
      this._eventIndex = null;
    }
    return this;
  }

  /**
   * Active-element list at coordinate `i`. RFC §3.3.
   *
   * O(log |segments| + r) once the index is built. Returns an empty
   * {@link Slot} for coordinates outside every segment.
   */
  at(i: number): Slot<E> {
    this._ensureEventIndexFresh();
    const idx = this._eventIndex!;
    const seg = idx.segmentAt(i);
    if (seg === null) return new Slot([]);
    return new Slot(seg.active);
  }

  /**
   * Merged ranges for `element` as `Interval[]`. RFC §3.4.
   *
   * Returns an empty array when no element with this `keyFn` value
   * has ever been inserted.
   */
  getRange(element: E): Interval[] {
    const key = this._keyFn(element);
    const entry = this._byKey.get(key);
    return entry ? entry.set.toIntervals() : [];
  }

  /**
   * Open / close events within the inclusive coordinate range
   * `[from, to]`. RFC §3.5.
   *
   * `to: null` means +∞ (include all events through the upper bound).
   *
   * Throws {@link InvalidIntervalError} if `from > to`.
   */
  transitions(range: { from: number; to: number | null }): TransitionEvent<E>[] {
    const { from, to } = range;
    if (typeof from !== "number" || Number.isNaN(from)) {
      throw new InvalidIntervalError("transitions: from must be a number");
    }
    if (to !== null && typeof to !== "number") {
      throw new InvalidIntervalError("transitions: to must be a number or null");
    }
    if (to !== null && from > to) {
      throw new InvalidIntervalError(`from (${from}) > to (${to})`);
    }

    this._ensureEventIndexFresh();
    const idx = this._eventIndex!;
    let upper: number | null;
    if (to === null) {
      upper = null;
    } else if (this._intMaxSentinel !== null && to === this._intMaxSentinel) {
      // RFC §4.7 C4: succ(Some(Int.max)) := None. Querying through the
      // sentinel must include the None close events.
      upper = null;
    } else {
      upper = to + 1;
    }
    return idx.eventsInRange(from, upper);
  }

  /**
   * Iterate `[element, intervals]` pairs in first-insert order ascending.
   */
  *[Symbol.iterator](): IterableIterator<[E, Interval[]]> {
    for (const entry of this._byKey.values()) {
      yield [entry.element, entry.set.toIntervals()];
    }
  }

  /**
   * Deep copy. Mutation on the copy MUST NOT affect this instance,
   * and vice versa.
   */
  copy(): Rangeable<E> {
    const dup = new Rangeable<E>({
      keyFn: this._keyFn,
      ...(this._intMaxSentinel !== null
        ? { intMaxSentinel: this._intMaxSentinel }
        : {}),
    });
    for (const [key, entry] of this._byKey) {
      const newSet = new DisjointSet();
      for (const iv of entry.set) {
        newSet.insert(iv.lo, iv.hi);
      }
      dup._byKey.set(key, {
        element: entry.element,
        set: newSet,
        ord: entry.ord,
      });
    }
    dup._version = this._version;
    return dup;
  }

  private _ensureEventIndexFresh(): void {
    if (this._eventIndex !== null && this._eventIndex.version === this._version) {
      return;
    }
    const vStart = this._version;
    const rebuilt = BoundaryIndex.build<E>(this._byKey, vStart, this._intMaxSentinel);
    if (this._version === vStart) {
      this._eventIndex = rebuilt;
    }
  }
}

export { RangeableError, InvalidIntervalError } from "./errors.js";
