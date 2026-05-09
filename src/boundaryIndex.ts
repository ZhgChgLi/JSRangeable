import type { DisjointSet } from "./disjointSet.js";
import { TransitionEvent, type TransitionKind } from "./transition.js";

/** Internal raw event carrying the ord tiebreaker. */
interface RawEvent<E> {
  coordinate: number | null;
  kind: TransitionKind;
  element: E;
  ord: number;
}

/** One maximal run of integers over which the active set is constant. */
export interface Segment<E> {
  readonly lo: number;
  readonly hi: number;
  readonly active: readonly E[];
}

/**
 * Total order over coordinates: `null` (== +∞) is greater than any
 * finite number. Returns -1 / 0 / +1.
 */
function compareCoord(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function coordLe(coord: number | null, upper: number | null): boolean {
  return compareCoord(coord, upper) <= 0;
}

function coordGe(coord: number | null, threshold: number | null): boolean {
  return compareCoord(coord, threshold) >= 0;
}

/**
 * Lazy boundary-event index per RFC §5.2 / §6.3. Built from a snapshot
 * of the per-element interval map plus the insertion-order map `ord`.
 */
export class BoundaryIndex<E> {
  readonly events: ReadonlyArray<TransitionEvent<E>>;
  readonly segments: ReadonlyArray<Segment<E>>;
  readonly version: number;

  constructor(
    events: ReadonlyArray<TransitionEvent<E>>,
    segments: ReadonlyArray<Segment<E>>,
    version: number,
  ) {
    this.events = events;
    this.segments = segments;
    this.version = version;
    Object.freeze(this);
  }

  /**
   * Find the segment containing `coord`, or `null` if none.
   * O(log |segments|). `coord` must be a finite number.
   */
  segmentAt(coord: number): Segment<E> | null {
    const segs = this.segments;
    let lo = 0;
    let hi = segs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (segs[mid]!.hi >= coord) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    if (lo >= segs.length) return null;
    const seg = segs[lo]!;
    return seg.lo <= coord ? seg : null;
  }

  /**
   * Returns events whose coordinate falls in `[lo, upperCoord]`.
   * `upperCoord` may be `null` to mean +∞.
   */
  eventsInRange(lo: number, upperCoord: number | null): TransitionEvent<E>[] {
    const events = this.events;
    const n = events.length;
    let l = 0;
    let r = n;
    while (l < r) {
      const m = (l + r) >>> 1;
      if (coordGe(events[m]!.coordinate, lo)) {
        r = m;
      } else {
        l = m + 1;
      }
    }
    const result: TransitionEvent<E>[] = [];
    let i = l;
    while (i < n && coordLe(events[i]!.coordinate, upperCoord)) {
      result.push(events[i]!);
      i += 1;
    }
    return result;
  }

  /**
   * Build a fresh index from the per-element interval map and the
   * insertion-order map `ord`. `intMaxSentinel` (default `null`) lets
   * the caller opt into "treat `hi === sentinel` as +∞" semantics for
   * cross-language fixture parity with bounded-int languages.
   */
  static build<E>(
    intervals: Map<string | number, { element: E; set: DisjointSet; ord: number }>,
    snapshotVersion: number,
    intMaxSentinel: number | null = null,
  ): BoundaryIndex<E> {
    const raw: RawEvent<E>[] = [];
    for (const [, entry] of intervals) {
      const { element, set, ord } = entry;
      for (const iv of set) {
        raw.push({
          coordinate: iv.lo,
          kind: "open",
          element,
          ord,
        });
        let closeCoord: number | null;
        if (intMaxSentinel !== null && iv.hi === intMaxSentinel) {
          closeCoord = null;
        } else {
          closeCoord = iv.hi + 1;
        }
        raw.push({
          coordinate: closeCoord,
          kind: "close",
          element,
          ord,
        });
      }
    }

    // Sort: coord ascending (null > finite); same-coord opens before
    // closes; same-coord-and-kind opens by ord asc, closes by ord desc.
    raw.sort((a, b) => {
      const c = compareCoord(a.coordinate, b.coordinate);
      if (c !== 0) return c;
      const aKind = a.kind === "open" ? 0 : 1;
      const bKind = b.kind === "open" ? 0 : 1;
      if (aKind !== bKind) return aKind - bKind;
      if (a.kind === "open") return a.ord - b.ord;
      return b.ord - a.ord;
    });

    const publicEvents: TransitionEvent<E>[] = raw.map(
      (ev) => new TransitionEvent(ev.coordinate, ev.kind, ev.element),
    );
    const segments = BoundaryIndex._materialiseSegments(raw);
    return new BoundaryIndex(publicEvents, segments, snapshotVersion);
  }

  /**
   * Sweep events linearly, materialising a Segment for every maximal
   * run of integers over which the active set is constant. Per RFC §6.3
   * we do not emit a segment whose active set is empty.
   */
  private static _materialiseSegments<E>(events: RawEvent<E>[]): Segment<E>[] {
    const segments: Segment<E>[] = [];
    const activeByOrd = new Map<number, E>();
    let prevCoord: number | null = null;
    let i = 0;
    const n = events.length;
    while (i < n) {
      const coord = events[i]!.coordinate;

      // Emit segment for [prevCoord, coord - 1] before processing
      // events at this coord, if the active set is non-empty.
      if (prevCoord !== null && activeByOrd.size > 0 && coord !== null) {
        const segHi = coord - 1;
        const sortedOrds = Array.from(activeByOrd.keys()).sort((a, b) => a - b);
        const snapshot = sortedOrds.map((o) => activeByOrd.get(o)!);
        segments.push({ lo: prevCoord, hi: segHi, active: snapshot });
      }

      // Apply every event at this coord.
      while (i < n && events[i]!.coordinate === coord) {
        const evI = events[i]!;
        if (evI.kind === "open") {
          activeByOrd.set(evI.ord, evI.element);
        } else {
          activeByOrd.delete(evI.ord);
        }
        i += 1;
      }

      prevCoord = coord;
    }
    return segments;
  }
}
