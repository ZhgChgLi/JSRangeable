import { InvalidIntervalError } from "./errors.js";
import { Interval } from "./interval.js";

/**
 * Outcome of {@link DisjointSet.insert}. The owning {@link Rangeable}
 * bumps its version counter only on `mutated`; `idempotent` means the
 * insert was absorbed and the canonical state is unchanged (RFC Test #21,
 * Lemma 6.5.B).
 */
export type InsertResult = "mutated" | "idempotent";

/**
 * Sorted, disjoint, non-adjacent merged-interval list for one element.
 *
 * Maintains the RFC §5.1 (I1) invariant:
 *
 *   * sorted by `lo` strictly ascending
 *   * any two adjacent entries `(lo1, hi1), (lo2, hi2)` satisfy
 *     `hi1 + 1 < lo2` (no overlap, no integer adjacency)
 *   * `lo <= hi` for every entry
 */
export class DisjointSet {
  /** Internal sorted list of merged intervals. */
  private _entries: Interval[] = [];

  get size(): number {
    return this._entries.length;
  }

  get empty(): boolean {
    return this._entries.length === 0;
  }

  *[Symbol.iterator](): IterableIterator<Interval> {
    yield* this._entries;
  }

  toIntervals(): Interval[] {
    return this._entries.slice();
  }

  toPairs(): [number, number][] {
    return this._entries.map((iv) => [iv.lo, iv.hi]);
  }

  /**
   * Insert `[lo, hi]` into the set, performing union-with-merge per RFC §6.1.
   *
   * Returns `'mutated'` if the canonical state changed (caller should
   * bump version), `'idempotent'` if the insert was absorbed by an
   * existing entry (caller MUST NOT bump version, per Test #21 and
   * Lemma 6.5.B).
   */
  insert(lo: number, hi: number): InsertResult {
    if (lo > hi) {
      throw new InvalidIntervalError(`lo (${lo}) > hi (${hi})`);
    }

    // Step 4 of §6.1: bsearch for the leftmost touch candidate.
    // Predicate: `iv.hi + 1 >= lo`. We use `iv.hi + 1` (not `lo - 1`)
    // to mirror the Ruby/Swift form for cross-language byte parity.
    const i0 = this._bsearchFirstTouch(lo);

    // Step 5: collect contiguous touch entries while
    // `entries[i].lo <= hi + 1`.
    let toMergeEnd = i0;
    const n = this._entries.length;
    while (toMergeEnd < n && this._entries[toMergeEnd]!.lo <= hi + 1) {
      toMergeEnd += 1;
    }
    const mergeCount = toMergeEnd - i0;

    // Step 6: containment idempotent fast-path. If we touch exactly one
    // existing entry that fully covers [lo, hi], this insert is a no-op.
    // MUST NOT mutate, MUST NOT bump version.
    if (mergeCount === 1) {
      const existing = this._entries[i0]!;
      if (existing.lo <= lo && hi <= existing.hi) {
        return "idempotent";
      }
    }

    // Step 7: real mutation path. Compute merged bounds, splice in.
    let newLo = lo;
    let newHi = hi;
    if (mergeCount > 0) {
      const first = this._entries[i0]!;
      const last = this._entries[toMergeEnd - 1]!;
      if (first.lo < newLo) newLo = first.lo;
      if (last.hi > newHi) newHi = last.hi;
    }
    const merged = new Interval(newLo, newHi);
    this._entries.splice(i0, mergeCount, merged);
    return "mutated";
  }

  /** Find leftmost index `i` where `entries[i].hi + 1 >= lo`. */
  private _bsearchFirstTouch(lo: number): number {
    let l = 0;
    let r = this._entries.length;
    while (l < r) {
      const m = (l + r) >>> 1;
      if (this._entries[m]!.hi + 1 >= lo) {
        r = m;
      } else {
        l = m + 1;
      }
    }
    return l;
  }
}
