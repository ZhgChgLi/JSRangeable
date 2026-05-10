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
 * Outcome of {@link DisjointSet.subtract}. The owning {@link Rangeable}
 * bumps `version` only on a non-`unchanged` outcome; `becameEmpty` lets
 * the container drive eager pruning per RFC §4.10 (N1).
 */
export type SubtractResult =
  | { kind: "unchanged" }
  | { kind: "mutated"; becameEmpty: boolean };

/**
 * Sorted, disjoint, non-adjacent merged-interval list for one element.
 *
 * Maintains the RFC §5.1 (I1) invariant:
 *
 *   * sorted by `lo` strictly ascending
 *   * any two adjacent entries `(lo1, hi1), (lo2, hi2)` satisfy
 *     `hi1 + 1 < lo2` (no overlap, no integer adjacency)
 *   * `lo <= hi` for every entry
 *   * (v2, I1.4) the list MUST be non-empty when stored in a `Rangeable`;
 *     callers MUST eager-prune the owning element when this list becomes
 *     empty (see RFC §4.10).
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

  /**
   * Subtract `[lo, hi]` from the set per RFC §6.6.
   *
   * Implements the bsearch + sweep algorithm; produces 0..2 residuals
   * per overlapped entry. Returns `{ kind: 'unchanged' }` when no entry
   * overlaps `[lo, hi]` (the caller MUST NOT bump version, per RFC
   * §4.10 N3); otherwise returns `{ kind: 'mutated', becameEmpty }`
   * where `becameEmpty` drives the eager-prune path (§4.10 N1).
   *
   * Throws {@link InvalidIntervalError} if `lo > hi`.
   *
   * Underflow / overflow safety (RFC §6.6 dual of §6.1 P5):
   *   * `lo - 1` is computed only when `iv.lo < lo`, so `lo > iv.lo`,
   *     hence `lo > Number.MIN_SAFE_INTEGER` in practice (i.e. never
   *     underflows for in-range integer coordinates).
   *   * `hi + 1` is computed only when `hi < iv.hi`, so `hi < iv.hi`,
   *     hence `hi < Number.MAX_SAFE_INTEGER` in practice.
   */
  subtract(lo: number, hi: number): SubtractResult {
    if (lo > hi) {
      throw new InvalidIntervalError(`lo (${lo}) > hi (${hi})`);
    }

    // Step 3: bsearch for leftmost entry overlapping [lo, hi]
    //   predicate: iv.hi >= lo
    const i0 = this._bsearchFirstOverlap(lo);
    const n = this._entries.length;

    // Step 4: quick-exit when nothing overlaps
    if (i0 >= n || this._entries[i0]!.lo > hi) {
      return { kind: "unchanged" };
    }

    // Step 5: sweep
    let i = i0;
    const replacements: Interval[] = [];
    while (i < n && this._entries[i]!.lo <= hi) {
      const iv = this._entries[i]!;
      if (iv.lo < lo) {
        replacements.push(new Interval(iv.lo, lo - 1));
      }
      if (hi < iv.hi) {
        replacements.push(new Interval(hi + 1, iv.hi));
      }
      i += 1;
    }
    const sweepEnd = i;

    // Step 7: splice
    this._entries.splice(i0, sweepEnd - i0, ...replacements);

    return { kind: "mutated", becameEmpty: this._entries.length === 0 };
  }

  /**
   * Two-pointer linear merge of two `(I1)`-canonical interval lists,
   * collapsing on overlap or integer adjacency. RFC §6.10
   * `merge_disjoint_lists`. Result is `(I1)`-canonical.
   *
   * Public so the owning {@link Rangeable} can drive set ops at the
   * container level without re-marshalling.
   */
  static mergeLists(a: readonly Interval[], b: readonly Interval[]): Interval[] {
    const out: Interval[] = [];
    const append = (iv: Interval): void => {
      if (out.length === 0 || out[out.length - 1]!.hi + 1 < iv.lo) {
        out.push(iv);
      } else {
        // Overlap or integer-adjacent: extend last entry's hi.
        const last = out[out.length - 1]!;
        const newHi = last.hi > iv.hi ? last.hi : iv.hi;
        if (newHi !== last.hi) {
          out[out.length - 1] = new Interval(last.lo, newHi);
        }
      }
    };

    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i]!.lo <= b[j]!.lo) {
        append(a[i]!);
        i += 1;
      } else {
        append(b[j]!);
        j += 1;
      }
    }
    while (i < a.length) {
      append(a[i]!);
      i += 1;
    }
    while (j < b.length) {
      append(b[j]!);
      j += 1;
    }
    return out;
  }

  /**
   * Two-pointer pairwise intersection of two `(I1)`-canonical lists.
   * RFC §6.11 `intersect_disjoint_lists`. Result is `(I1)`-canonical
   * by Lemma 6.11.A (no adjacency-collapse needed).
   */
  static intersectLists(a: readonly Interval[], b: readonly Interval[]): Interval[] {
    const out: Interval[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const ai = a[i]!;
      const bj = b[j]!;
      const lo = ai.lo > bj.lo ? ai.lo : bj.lo;
      const hi = ai.hi < bj.hi ? ai.hi : bj.hi;
      if (lo <= hi) {
        out.push(new Interval(lo, hi));
      }
      if (ai.hi <= bj.hi) {
        i += 1;
      } else {
        j += 1;
      }
    }
    return out;
  }

  /**
   * Two-pointer subtraction `a \ b` over two `(I1)`-canonical lists.
   * RFC §6.12 `subtract_disjoint_lists`. Result is `(I1)`-canonical.
   *
   * Underflow / overflow safety (RFC §6.12 dual of §6.1 P5):
   *   * `b[j].lo - 1` is computed only when `b[j].lo > current_lo`,
   *     hence `b[j].lo > Int.min`.
   *   * `b[j].hi + 1` is computed only when `b[j].hi < current_hi`,
   *     hence `b[j].hi < Int.max`.
   */
  static subtractLists(a: readonly Interval[], b: readonly Interval[]): Interval[] {
    const out: Interval[] = [];
    if (a.length === 0) return out;
    if (b.length === 0) return a.slice();

    let i = 0;
    let j = 0;
    let curLo: number | null = null;
    let curHi: number | null = null;

    while (i < a.length) {
      if (curLo === null) {
        curLo = a[i]!.lo;
        curHi = a[i]!.hi;
      }
      // Skip b entries strictly before [curLo, curHi]
      while (j < b.length && b[j]!.hi < curLo) {
        j += 1;
      }
      if (j === b.length || b[j]!.lo > curHi!) {
        // No more cuts on this entry: commit and advance i
        out.push(new Interval(curLo, curHi!));
        i += 1;
        curLo = null;
        curHi = null;
        continue;
      }
      // b[j] overlaps [curLo, curHi]
      const bj = b[j]!;
      if (bj.lo > curLo) {
        out.push(new Interval(curLo, bj.lo - 1));
      }
      if (bj.hi < curHi!) {
        // Right residual remains "current"; consume b[j]
        curLo = bj.hi + 1;
        j += 1;
      } else {
        // b[j] swallows the rest of current entry; advance i
        i += 1;
        curLo = null;
        curHi = null;
      }
    }
    return out;
  }

  /**
   * Internal: replace the entire entry list with a pre-canonical list.
   *
   * The caller (the owning {@link Rangeable}) has guaranteed `entries`
   * is `(I1)`-canonical; we adopt it by reference (no defensive copy).
   * Used by container-level set ops to swap merged results in place.
   */
  _replaceEntries(entries: Interval[]): void {
    this._entries = entries;
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

  /** Find leftmost index `i` where `entries[i].hi >= lo` (strict overlap). */
  private _bsearchFirstOverlap(lo: number): number {
    let l = 0;
    let r = this._entries.length;
    while (l < r) {
      const m = (l + r) >>> 1;
      if (this._entries[m]!.hi >= lo) {
        r = m;
      } else {
        l = m + 1;
      }
    }
    return l;
  }
}
