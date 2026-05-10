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

  // -------------------------------------------------------------------- //
  // v2 — Removal (RFC §6.6 – §6.9)
  // -------------------------------------------------------------------- //

  /**
   * Subtract the closed interval `[start, end]` from `R(element)`.
   * RFC §6.6.
   *
   * Idempotent when no entry of `R(element)` overlaps `[start, end]`
   * (no version bump, no `event_index` invalidation; §4.10 N3).
   *
   * If the subtraction empties `R(element)`, the element is eagerly
   * pruned (§4.10 N1): excised from `intervals`, `insertion_order`,
   * and `ord`; surviving elements' `ord` is densely renumbered.
   *
   * Throws {@link InvalidIntervalError} if `start > end`.
   *
   * Returns `this` for chaining.
   */
  remove(element: E, range: { start: number; end: number }): this {
    const { start, end } = range;
    if (start > end) {
      throw new InvalidIntervalError(`start (${start}) > end (${end})`);
    }

    const key = this._keyFn(element);
    const entry = this._byKey.get(key);
    if (entry === undefined) {
      // §4.10 N3: removing from a never-inserted element is a no-op
      return this;
    }

    const result = entry.set.subtract(start, end);
    if (result.kind === "unchanged") {
      // §6.6 step 4 idempotent no-op
      return this;
    }

    if (result.becameEmpty) {
      this._excise(key);
    }

    this._version += 1;
    this._eventIndex = null;
    return this;
  }

  /**
   * Excise `element` entirely. RFC §6.7.
   *
   * No-op when the element is not present (no version bump; §4.10 N3).
   * Returns `this` for chaining.
   */
  removeElement(element: E): this {
    const key = this._keyFn(element);
    if (!this._byKey.has(key)) {
      // §4.10 N3
      return this;
    }
    this._excise(key);
    this._version += 1;
    this._eventIndex = null;
    return this;
  }

  /**
   * Empty the container. RFC §6.8.
   *
   * No-op when already empty (no version bump; §4.10 N3).
   * Returns `this` for chaining.
   */
  clear(): this {
    if (this._byKey.size === 0) {
      // §4.10 N3
      return this;
    }
    this._byKey.clear();
    this._version += 1;
    this._eventIndex = null;
    return this;
  }

  /**
   * Subtract `[start, end]` from every element's `R(e)`. RFC §6.9.
   *
   * Atomic: a single version bump for the entire op; eager pruning
   * happens for every element that becomes empty in this single op.
   * If no element changes, the op is a no-op (§4.10 N3): no version
   * bump, no `event_index` invalidation.
   *
   * Throws {@link InvalidIntervalError} if `start > end` (raised
   * before any mutation; container state unchanged on raise).
   *
   * Returns `this` for chaining.
   */
  removeRanges(range: { start: number; end: number }): this {
    const { start, end } = range;
    if (start > end) {
      throw new InvalidIntervalError(`start (${start}) > end (${end})`);
    }

    let anyChange = false;
    let anyPruned = false;
    // Snapshot keys: we mutate `_byKey` while iterating.
    const keys = Array.from(this._byKey.keys());
    for (const key of keys) {
      const entry = this._byKey.get(key)!;
      const result = entry.set.subtract(start, end);
      if (result.kind === "mutated") {
        anyChange = true;
        if (result.becameEmpty) {
          this._byKey.delete(key);
          anyPruned = true;
        }
      }
    }

    if (!anyChange) {
      // §4.10 N3
      return this;
    }

    if (anyPruned) {
      this._renumberOrd();
    }

    this._version += 1;
    this._eventIndex = null;
    return this;
  }

  // -------------------------------------------------------------------- //
  // v2 — Set operations, mutating (RFC §6.10 – §6.13 in-place form)
  // -------------------------------------------------------------------- //

  /**
   * In-place union with `other`. RFC §6.10 mutating form.
   *
   * MUST NOT bump version when the result is structurally equal to
   * `this` (idempotence dual of §3.2; e.g. `r.unionInPlace(r)` or
   * any subset of `R_self(e)` for every key in `other`).
   *
   * Throws {@link RangeableError} when `other` was built with a
   * different `keyFn`. Returns `this` for chaining.
   */
  unionInPlace(other: Rangeable<E>): this {
    this._assertSameKeyFn(other);
    if (other === this || other._byKey.size === 0) {
      return this;
    }
    let dirty = false;

    // 1. For every element already present, merge with `other`'s list (if any).
    for (const entry of this._byKey.values()) {
      const key = this._keyFn(entry.element);
      const otherEntry = other._byKey.get(key);
      if (otherEntry === undefined) continue;
      const merged = DisjointSet.mergeLists(
        entry.set.toIntervals(),
        otherEntry.set.toIntervals(),
      );
      if (!Rangeable._intervalListsEqual(entry.set.toIntervals(), merged)) {
        entry.set._replaceEntries(merged);
        dirty = true;
      }
    }

    // 2. Tail-append elements that exist only in `other`, in `other`'s
    //    insertion order.
    for (const otherEntry of other._byKey.values()) {
      const otherKey = this._keyFn(otherEntry.element);
      if (this._byKey.has(otherKey)) continue;
      const newSet = new DisjointSet();
      newSet._replaceEntries(otherEntry.set.toIntervals());
      this._byKey.set(otherKey, {
        element: otherEntry.element,
        set: newSet,
        ord: this._byKey.size + 1,
      });
      dirty = true;
    }

    if (dirty) {
      this._version += 1;
      this._eventIndex = null;
    }
    return this;
  }

  /**
   * In-place intersection with `other`. RFC §6.11 mutating form.
   *
   * MUST NOT bump version when the result is structurally equal to
   * `this`. Elements with empty result are eagerly pruned (§4.10).
   *
   * Throws {@link RangeableError} when `other` was built with a
   * different `keyFn`. Returns `this` for chaining.
   */
  intersectInPlace(other: Rangeable<E>): this {
    this._assertSameKeyFn(other);
    if (other === this) {
      return this; // structurally equal: no bump
    }
    let dirty = false;
    let anyPruned = false;
    const keys = Array.from(this._byKey.keys());
    for (const key of keys) {
      const entry = this._byKey.get(key)!;
      const otherEntry = other._byKey.get(key);
      if (otherEntry === undefined) {
        // Drop key not in `other`.
        this._byKey.delete(key);
        dirty = true;
        anyPruned = true;
        continue;
      }
      const intersected = DisjointSet.intersectLists(
        entry.set.toIntervals(),
        otherEntry.set.toIntervals(),
      );
      if (intersected.length === 0) {
        // §4.10 eager prune
        this._byKey.delete(key);
        dirty = true;
        anyPruned = true;
        continue;
      }
      if (!Rangeable._intervalListsEqual(entry.set.toIntervals(), intersected)) {
        entry.set._replaceEntries(intersected);
        dirty = true;
      }
    }
    if (anyPruned) {
      this._renumberOrd();
    }
    if (dirty) {
      this._version += 1;
      this._eventIndex = null;
    }
    return this;
  }

  /**
   * In-place subtraction with `other` (a.k.a. `differenceInPlace`).
   * RFC §6.12 mutating form.
   *
   * MUST NOT bump version when the result is structurally equal to
   * `this`. Elements with empty result are eagerly pruned (§4.10).
   *
   * Throws {@link RangeableError} when `other` was built with a
   * different `keyFn`. Returns `this` for chaining.
   */
  subtractInPlace(other: Rangeable<E>): this {
    this._assertSameKeyFn(other);
    if (other === this) {
      // self - self = empty
      if (this._byKey.size === 0) return this;
      this._byKey.clear();
      this._version += 1;
      this._eventIndex = null;
      return this;
    }
    let dirty = false;
    let anyPruned = false;
    const keys = Array.from(this._byKey.keys());
    for (const key of keys) {
      const entry = this._byKey.get(key)!;
      const otherEntry = other._byKey.get(key);
      if (otherEntry === undefined) continue;
      const remaining = DisjointSet.subtractLists(
        entry.set.toIntervals(),
        otherEntry.set.toIntervals(),
      );
      if (remaining.length === 0) {
        this._byKey.delete(key);
        dirty = true;
        anyPruned = true;
        continue;
      }
      if (!Rangeable._intervalListsEqual(entry.set.toIntervals(), remaining)) {
        entry.set._replaceEntries(remaining);
        dirty = true;
      }
    }
    if (anyPruned) {
      this._renumberOrd();
    }
    if (dirty) {
      this._version += 1;
      this._eventIndex = null;
    }
    return this;
  }

  /**
   * In-place symmetric difference with `other`. RFC §6.13 mutating form.
   *
   * MUST NOT bump version when the result is structurally equal to
   * `this`. Elements with empty result are eagerly pruned (§4.10).
   *
   * Throws {@link RangeableError} when `other` was built with a
   * different `keyFn`. Returns `this` for chaining.
   */
  symmetricDifferenceInPlace(other: Rangeable<E>): this {
    this._assertSameKeyFn(other);
    if (other === this) {
      // self △ self = empty
      if (this._byKey.size === 0) return this;
      this._byKey.clear();
      this._version += 1;
      this._eventIndex = null;
      return this;
    }
    let dirty = false;
    let anyPruned = false;
    const selfKeys = Array.from(this._byKey.keys());
    for (const key of selfKeys) {
      const entry = this._byKey.get(key)!;
      const otherEntry = other._byKey.get(key);
      const aList = entry.set.toIntervals();
      const bList = otherEntry === undefined ? [] : otherEntry.set.toIntervals();
      const aMinusB = DisjointSet.subtractLists(aList, bList);
      const bMinusA = DisjointSet.subtractLists(bList, aList);
      const sym = DisjointSet.mergeLists(aMinusB, bMinusA);
      if (sym.length === 0) {
        this._byKey.delete(key);
        dirty = true;
        anyPruned = true;
        continue;
      }
      if (!Rangeable._intervalListsEqual(aList, sym)) {
        entry.set._replaceEntries(sym);
        dirty = true;
      }
    }
    // Tail-append other-only keys (their R(e) is unchanged by the empty
    // self side; sym = b \ ∅ = b).
    for (const otherEntry of other._byKey.values()) {
      const otherKey = this._keyFn(otherEntry.element);
      if (this._byKey.has(otherKey)) continue;
      const newSet = new DisjointSet();
      newSet._replaceEntries(otherEntry.set.toIntervals());
      this._byKey.set(otherKey, {
        element: otherEntry.element,
        set: newSet,
        ord: this._byKey.size + 1,
      });
      dirty = true;
    }
    if (anyPruned) {
      this._renumberOrd();
    }
    if (dirty) {
      this._version += 1;
      this._eventIndex = null;
    }
    return this;
  }

  // -------------------------------------------------------------------- //
  // v2 — Set operations, non-mutating (RFC §6.10 – §6.13 returning form)
  // -------------------------------------------------------------------- //

  /** Non-mutating union; returns a fresh {@link Rangeable}. RFC §6.10. */
  union(other: Rangeable<E>): Rangeable<E> {
    this._assertSameKeyFn(other);
    const out = this._spawnEmpty();
    // 1. Walk self's order; merge with other's per-key list when present.
    for (const entry of this._byKey.values()) {
      const key = this._keyFn(entry.element);
      const otherEntry = other._byKey.get(key);
      const merged =
        otherEntry === undefined
          ? entry.set.toIntervals()
          : DisjointSet.mergeLists(
              entry.set.toIntervals(),
              otherEntry.set.toIntervals(),
            );
      out._adoptKey(key, entry.element, merged);
    }
    // 2. Tail-append other-only keys in other's insertion order.
    for (const otherEntry of other._byKey.values()) {
      const otherKey = this._keyFn(otherEntry.element);
      if (this._byKey.has(otherKey)) continue;
      out._adoptKey(otherKey, otherEntry.element, otherEntry.set.toIntervals());
    }
    return out;
  }

  /** Non-mutating intersection; returns a fresh {@link Rangeable}. RFC §6.11. */
  intersection(other: Rangeable<E>): Rangeable<E> {
    this._assertSameKeyFn(other);
    const out = this._spawnEmpty();
    for (const entry of this._byKey.values()) {
      const key = this._keyFn(entry.element);
      const otherEntry = other._byKey.get(key);
      if (otherEntry === undefined) continue;
      const intersected = DisjointSet.intersectLists(
        entry.set.toIntervals(),
        otherEntry.set.toIntervals(),
      );
      if (intersected.length === 0) continue; // §4.10 eager prune
      out._adoptKey(key, entry.element, intersected);
    }
    return out;
  }

  /** Non-mutating difference; returns a fresh {@link Rangeable}. RFC §6.12. */
  difference(other: Rangeable<E>): Rangeable<E> {
    this._assertSameKeyFn(other);
    const out = this._spawnEmpty();
    for (const entry of this._byKey.values()) {
      const key = this._keyFn(entry.element);
      const otherEntry = other._byKey.get(key);
      const remaining =
        otherEntry === undefined || otherEntry.set.size === 0
          ? entry.set.toIntervals()
          : DisjointSet.subtractLists(
              entry.set.toIntervals(),
              otherEntry.set.toIntervals(),
            );
      if (remaining.length === 0) continue; // §4.10 eager prune
      out._adoptKey(key, entry.element, remaining);
    }
    return out;
  }

  /**
   * Non-mutating symmetric difference; returns a fresh {@link Rangeable}.
   * RFC §6.13.
   */
  symmetricDifference(other: Rangeable<E>): Rangeable<E> {
    this._assertSameKeyFn(other);
    const out = this._spawnEmpty();
    // 1. self-primary keys: per-element (a \ b) ∪ (b \ a)
    for (const entry of this._byKey.values()) {
      const key = this._keyFn(entry.element);
      const otherEntry = other._byKey.get(key);
      const a = entry.set.toIntervals();
      const b = otherEntry === undefined ? [] : otherEntry.set.toIntervals();
      const aMinusB = DisjointSet.subtractLists(a, b);
      const bMinusA = DisjointSet.subtractLists(b, a);
      const sym = DisjointSet.mergeLists(aMinusB, bMinusA);
      if (sym.length === 0) continue;
      out._adoptKey(key, entry.element, sym);
    }
    // 2. other-only keys: copy other's list directly (b \ a degenerates
    //    to b when a is empty).
    for (const otherEntry of other._byKey.values()) {
      const otherKey = this._keyFn(otherEntry.element);
      if (this._byKey.has(otherKey)) continue;
      const list = otherEntry.set.toIntervals();
      if (list.length === 0) continue; // defensive (I1.4 forbids)
      out._adoptKey(otherKey, otherEntry.element, list);
    }
    return out;
  }

  // -------------------------------------------------------------------- //
  // Internal helpers
  // -------------------------------------------------------------------- //

  /**
   * Excise the given key from `_byKey` AND densely renumber `ord`
   * over the survivors. Used by `remove(e, …)` and `removeElement(e)`.
   */
  private _excise(key: string | number): void {
    const entry = this._byKey.get(key);
    if (entry === undefined) return;
    const removedOrd = entry.ord;
    this._byKey.delete(key);
    for (const e of this._byKey.values()) {
      if (e.ord > removedOrd) e.ord -= 1;
    }
  }

  /**
   * Densely renumber `ord` `1..N` over the surviving entries in their
   * existing insertion-order position (RFC §4.10 N1). Used after a
   * batch-prune (`removeRanges`, `intersectInPlace`, etc.) where
   * peeling per-deletion `_excise` would be O(E²).
   */
  private _renumberOrd(): void {
    let n = 0;
    for (const entry of this._byKey.values()) {
      n += 1;
      entry.ord = n;
    }
  }

  /** Throws when set ops attempt to mix two `Rangeable`s with distinct `keyFn`s. */
  private _assertSameKeyFn(other: Rangeable<E>): void {
    if (this._keyFn !== other._keyFn) {
      throw new RangeableError(
        "Rangeable: set operations require both operands to use the same keyFn",
      );
    }
  }

  /**
   * Construct an empty `Rangeable<E>` carrying the same `keyFn` and
   * `intMaxSentinel` as `this`. Used by non-mutating set ops to ensure
   * the result honors the same equivalence classes and the same +∞
   * sentinel propagation (RFC §9 case 37).
   */
  private _spawnEmpty(): Rangeable<E> {
    return new Rangeable<E>({
      keyFn: this._keyFn,
      ...(this._intMaxSentinel !== null
        ? { intMaxSentinel: this._intMaxSentinel }
        : {}),
    });
  }

  /**
   * Internal: tail-append a key with a pre-canonical interval list.
   * Used by non-mutating set ops. The caller guarantees `intervals`
   * is `(I1)`-canonical and non-empty.
   */
  private _adoptKey(
    key: string | number,
    element: E,
    intervals: Interval[],
  ): void {
    const set = new DisjointSet();
    set._replaceEntries(intervals);
    this._byKey.set(key, {
      element,
      set,
      ord: this._byKey.size + 1,
    });
  }

  /**
   * Per-element structural equality check on the canonical interval
   * lists. Used by mutating set ops to short-circuit the version bump
   * when the result is identical to the source (idempotence dual of
   * §3.2).
   */
  private static _intervalListsEqual(
    a: readonly Interval[],
    b: readonly Interval[],
  ): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i]!.lo !== b[i]!.lo || a[i]!.hi !== b[i]!.hi) return false;
    }
    return true;
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
