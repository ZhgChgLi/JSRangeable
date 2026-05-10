/**
 * RFC §10.B–§10.G — v2 normative test contract for Removal and Set Ops.
 *
 * Mirrors the Ruby/Swift v2 contract test suite shape and adds two
 * JS-specific groups:
 *
 *   * `keyFn` mismatch (RFC §9 case 36) — JS allows configurable
 *     `keyFn`, so set ops MUST throw `RangeableError` rather than
 *     silently coerce.
 *   * `intMaxSentinel` propagation (RFC §9 case 37) — non-mutating
 *     set ops MUST carry the sentinel through to the result container.
 *
 * Implementation references:
 *   * RFC §6.6 – §6.13 (algorithms)
 *   * RFC §4.10 (eager pruning)
 *   * RFC §10.B – §10.G (test contract)
 */

import { describe, expect, it } from "vitest";

import {
  InvalidIntervalError,
  Rangeable,
  RangeableError,
} from "../src/index.js";

// ------------------------------------------------------------------------ //
// Element types and helpers (mirrors contract.test.ts)
// ------------------------------------------------------------------------ //

interface Strong { kind: "strong"; }
interface Italic { kind: "italic"; }
interface Code { kind: "code"; }
interface Link { kind: "link"; url: string; }
type Markup = Strong | Italic | Code | Link;

const strong = (): Strong => ({ kind: "strong" });
const italic = (): Italic => ({ kind: "italic" });
const code = (): Code => ({ kind: "code" });
const link = (url: string): Link => ({ kind: "link", url });

const keyFn = (m: Markup): string =>
  m.kind === "link" ? `link:${m.url}` : m.kind;

const newR = () => new Rangeable<Markup>({ keyFn });

const tuples = (intervals: { lo: number; hi: number }[]) =>
  intervals.map((iv) => [iv.lo, iv.hi] as const);

/** Return the keys (as keyFn strings) in iteration order. */
const orderedKeys = (r: Rangeable<Markup>): string[] => {
  const out: string[] = [];
  for (const [el] of r) out.push(keyFn(el));
  return out;
};

// ------------------------------------------------------------------------ //
// 10.B-A — remove(e, start, end) (RFC §6.6)
// ------------------------------------------------------------------------ //

describe("RFC §10.B-A — remove(e, start, end)", () => {
  it("Test #21 — no overlap is a no-op (no version bump)", () => {
    const r = newR();
    r.insert(strong(), { start: 10, end: 20 });
    const v0 = r.version;
    r.remove(strong(), { start: 0, end: 5 });
    expect(tuples(r.getRange(strong()))).toEqual([[10, 20]]);
    expect(r.version).toBe(v0);
    expect(r.size).toBe(1);
  });

  it("Test #22 — exact match consumes one entry, prunes element", () => {
    const r = newR();
    r.insert(strong(), { start: 10, end: 20 });
    r.remove(strong(), { start: 10, end: 20 });
    expect(r.size).toBe(0);
    expect(r.empty).toBe(true);
    expect(orderedKeys(r)).toEqual([]);
  });

  it("Test #23 — leaves left residual only", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 10 });
    r.remove(strong(), { start: 5, end: 100 });
    expect(tuples(r.getRange(strong()))).toEqual([[0, 4]]);
  });

  it("Test #24 — leaves right residual only", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 10 });
    r.remove(strong(), { start: -100, end: 5 });
    expect(tuples(r.getRange(strong()))).toEqual([[6, 10]]);
  });

  it("Test #25 — splits one entry into two", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 10 });
    r.remove(strong(), { start: 3, end: 6 });
    expect(tuples(r.getRange(strong()))).toEqual([
      [0, 2],
      [7, 10],
    ]);
  });

  it("Test #26 — spans multiple entries", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(strong(), { start: 10, end: 15 });
    r.insert(strong(), { start: 20, end: 25 });
    r.remove(strong(), { start: 3, end: 22 });
    expect(tuples(r.getRange(strong()))).toEqual([
      [0, 2],
      [23, 25],
    ]);
  });

  it("Test #27 — full prune renumbers ord of survivors", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(strong(), { start: 10, end: 15 });
    r.insert(italic(), { start: 7, end: 8 });
    const v0 = r.version;
    r.remove(strong(), { start: -100, end: 100 });
    expect(r.size).toBe(1);
    expect(orderedKeys(r)).toEqual(["italic"]);
    expect(r.version).toBe(v0 + 1);
    // Italic now occupies ord 1; verify via at()
    expect(r.at(7).objs).toEqual([italic()]);
  });

  it("Test #28 — no-op MUST NOT bump version (no overlap and missing element)", () => {
    const r = newR();
    r.insert(strong(), { start: 10, end: 20 });
    const v0 = r.version;
    r.remove(strong(), { start: 30, end: 40 });
    const v1 = r.version;
    r.remove(italic(), { start: 0, end: 5 });
    const v2 = r.version;
    expect(v0).toBe(v1);
    expect(v1).toBe(v2);
  });

  it("Test #29 — start > end raises and leaves state unchanged", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 10 });
    expect(() => r.remove(strong(), { start: 7, end: 3 })).toThrow(
      InvalidIntervalError,
    );
    expect(tuples(r.getRange(strong()))).toEqual([[0, 10]]);
  });

  it("Test #30 — start at min-int simulator (no underflow)", () => {
    const intMin = -(2 ** 31);
    const r = newR();
    r.insert(strong(), { start: intMin, end: intMin + 100 });
    r.remove(strong(), { start: intMin, end: intMin + 50 });
    expect(tuples(r.getRange(strong()))).toEqual([
      [intMin + 51, intMin + 100],
    ]);
  });

  it("Test #31 — end at max-int simulator (no overflow)", () => {
    const intMax = (2 ** 31) - 1;
    const r = newR();
    r.insert(strong(), { start: 0, end: intMax });
    r.remove(strong(), { start: 1000, end: intMax });
    expect(tuples(r.getRange(strong()))).toEqual([[0, 999]]);
  });

  it("returns this for chaining", () => {
    const r = newR();
    const out = r
      .insert(strong(), { start: 0, end: 10 })
      .remove(strong(), { start: 5, end: 6 });
    expect(out).toBe(r);
  });

  it("event_index is invalidated after a removing mutation", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 10 });
    expect(r.at(5).objs).toEqual([strong()]);
    r.remove(strong(), { start: 4, end: 6 });
    expect(r.at(5).objs).toEqual([]);
    expect(r.at(3).objs).toEqual([strong()]);
    expect(r.at(7).objs).toEqual([strong()]);
  });
});

// ------------------------------------------------------------------------ //
// 10.B-B — removeElement (RFC §6.7)
// ------------------------------------------------------------------------ //

describe("RFC §10.B-B — removeElement(e)", () => {
  it("Test #32 — excises element and renumbers ord densely", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(italic(), { start: 7, end: 12 });
    r.insert(code(), { start: 15, end: 20 });
    const v0 = r.version;
    r.removeElement(italic());
    expect(r.size).toBe(2);
    expect(orderedKeys(r)).toEqual(["strong", "code"]);
    expect(r.version).toBe(v0 + 1);
    // Verify ord by inspecting transitions order at a shared point: code
    // must now be the 2nd element in any ord-broken iteration.
    r.insert(strong(), { start: 100, end: 100 });
    r.insert(code(), { start: 100, end: 100 });
    expect(r.at(100).objs).toEqual([strong(), code()]);
  });

  it("Test #33 — removing never-inserted element MUST NOT bump version", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    const v0 = r.version;
    r.removeElement(italic());
    expect(r.size).toBe(1);
    expect(r.version).toBe(v0);
  });

  it("Test #34 — single-interval element", () => {
    const r = newR();
    r.insert(strong(), { start: 5, end: 10 });
    r.removeElement(strong());
    expect(r.empty).toBe(true);
    expect(r.size).toBe(0);
  });

  it("Test #35 — many-interval element", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(strong(), { start: 10, end: 15 });
    r.insert(strong(), { start: 20, end: 25 });
    r.removeElement(strong());
    expect(r.empty).toBe(true);
    expect(r.getRange(strong())).toEqual([]);
  });

  it("returns this for chaining", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    const out = r.removeElement(strong());
    expect(out).toBe(r);
  });
});

// ------------------------------------------------------------------------ //
// 10.B-C — clear (RFC §6.8)
// ------------------------------------------------------------------------ //

describe("RFC §10.B-C — clear()", () => {
  it("Test #36 — clears non-empty container with single bump", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(italic(), { start: 7, end: 12 });
    const v0 = r.version;
    r.clear();
    expect(r.empty).toBe(true);
    expect(r.size).toBe(0);
    expect(r.getRange(strong())).toEqual([]);
    expect(r.getRange(italic())).toEqual([]);
    expect(r.version).toBe(v0 + 1);
  });

  it("Test #37 — clearing an empty container MUST NOT bump version", () => {
    const r = newR();
    const v0 = r.version;
    r.clear();
    expect(r.empty).toBe(true);
    expect(r.version).toBe(v0);
  });

  it("Test #38 — post-clear at() and transitions() return empty", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.clear();
    expect(r.empty).toBe(true);
    expect(r.at(3).objs).toEqual([]);
    expect(r.transitions({ from: 0, to: 10 })).toEqual([]);
  });

  it("Test #39 — post-clear iteration yields nothing", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(italic(), { start: 7, end: 12 });
    r.clear();
    expect(r.size).toBe(0);
    expect([...r]).toEqual([]);
  });

  it("Test #40 — insert after clear assigns ord = 1 to next element", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(italic(), { start: 7, end: 12 });
    r.clear();
    r.insert(code(), { start: 100, end: 110 });
    expect(r.size).toBe(1);
    expect(orderedKeys(r)).toEqual(["code"]);
    // Verify the new key has ord 1 by ensuring it's the first/only at.
    expect(r.at(105).objs).toEqual([code()]);
  });

  it("returns this for chaining", () => {
    const r = newR();
    const out = r.clear();
    expect(out).toBe(r);
  });
});

// ------------------------------------------------------------------------ //
// 10.B-D — removeRanges (RFC §6.9)
// ------------------------------------------------------------------------ //

describe("RFC §10.B-D — removeRanges(start, end)", () => {
  it("Test #41 — single bump despite hitting multiple elements", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 10 });
    r.insert(italic(), { start: 5, end: 15 });
    r.insert(code(), { start: 100, end: 110 });
    const v0 = r.version;
    r.removeRanges({ start: 3, end: 8 });
    expect(tuples(r.getRange(strong()))).toEqual([
      [0, 2],
      [9, 10],
    ]);
    expect(tuples(r.getRange(italic()))).toEqual([[9, 15]]);
    expect(tuples(r.getRange(code()))).toEqual([[100, 110]]);
    expect(r.version).toBe(v0 + 1); // single bump, NOT three
  });

  it("Test #42 — no overlap MUST NOT bump version", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 10 });
    r.insert(italic(), { start: 50, end: 60 });
    const v0 = r.version;
    r.removeRanges({ start: 20, end: 30 });
    expect(tuples(r.getRange(strong()))).toEqual([[0, 10]]);
    expect(tuples(r.getRange(italic()))).toEqual([[50, 60]]);
    expect(r.version).toBe(v0);
  });

  it("Test #43 — fully covers all elements (clears container)", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(italic(), { start: 10, end: 20 });
    r.insert(code(), { start: 25, end: 30 });
    const v0 = r.version;
    r.removeRanges({ start: 0, end: 30 });
    expect(r.empty).toBe(true);
    expect(r.size).toBe(0);
    expect(r.version).toBe(v0 + 1);
  });

  it("Test #43 (variant) — partial prune renumbers ord", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(italic(), { start: 10, end: 20 });
    r.insert(code(), { start: 25, end: 30 });
    const v0 = r.version;
    r.removeRanges({ start: 8, end: 22 });
    expect(tuples(r.getRange(strong()))).toEqual([[0, 5]]);
    expect(tuples(r.getRange(italic()))).toEqual([]);
    expect(tuples(r.getRange(code()))).toEqual([[25, 30]]);
    expect(r.size).toBe(2);
    expect(orderedKeys(r)).toEqual(["strong", "code"]);
    expect(r.version).toBe(v0 + 1);
    // ord renumbered: code now 2; verify by at() at a coord where both
    // are forced active simultaneously.
    r.insert(strong(), { start: 100, end: 100 });
    r.insert(code(), { start: 100, end: 100 });
    expect(r.at(100).objs).toEqual([strong(), code()]);
  });

  it("start > end raises before any mutation", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 10 });
    const v0 = r.version;
    expect(() => r.removeRanges({ start: 10, end: 5 })).toThrow(
      InvalidIntervalError,
    );
    expect(tuples(r.getRange(strong()))).toEqual([[0, 10]]);
    expect(r.version).toBe(v0);
  });

  it("returns this for chaining", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 10 });
    const out = r.removeRanges({ start: 5, end: 6 });
    expect(out).toBe(r);
  });
});

// ------------------------------------------------------------------------ //
// Insert-after-remove ord reassignment (RFC §10.G #78, R14)
// ------------------------------------------------------------------------ //

describe("Insert-after-remove ord reassignment (Test #78 / §4.10 deliberate side effect)", () => {
  it("re-inserting a removed element places it at the tail of insertion_order", () => {
    const r = newR();
    r.insert(strong(), { start: 0, end: 5 });
    r.insert(italic(), { start: 10, end: 15 });
    r.removeElement(strong());
    r.insert(strong(), { start: 100, end: 110 });
    expect(orderedKeys(r)).toEqual(["italic", "strong"]);
    // Force shared coord to verify ord: italic comes first.
    r.insert(italic(), { start: 200, end: 200 });
    r.insert(strong(), { start: 200, end: 200 });
    expect(r.at(200).objs).toEqual([italic(), strong()]);
  });
});

// ------------------------------------------------------------------------ //
// 10.C — union (RFC §6.10)
// ------------------------------------------------------------------------ //

describe("RFC §10.C — union", () => {
  it("Test #44 — disjoint elements", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 5 });
    const r2 = newR().insert(italic(), { start: 10, end: 15 });
    const v1Before = r1.version;
    const v2Before = r2.version;
    const r3 = r1.union(r2);
    expect(r3.size).toBe(2);
    expect(orderedKeys(r3)).toEqual(["strong", "italic"]);
    expect(tuples(r3.getRange(strong()))).toEqual([[0, 5]]);
    expect(tuples(r3.getRange(italic()))).toEqual([[10, 15]]);
    expect(r3.version).toBe(0);
    expect(r1.version).toBe(v1Before);
    expect(r2.version).toBe(v2Before);
  });

  it("Test #45 — same key, overlapping intervals", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 5, end: 15 });
    const r3 = r1.union(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([[0, 15]]);
    expect(r3.size).toBe(1);
  });

  it("Test #46 — adjacency-merge (5+1==6)", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 5 });
    const r2 = newR().insert(strong(), { start: 6, end: 10 });
    const r3 = r1.union(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([[0, 10]]);
  });

  it("Test #47 — mutating union with idempotent subset MUST NOT bump version", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 10 })
      .insert(italic(), { start: 20, end: 30 });
    const r2 = newR().insert(strong(), { start: 3, end: 7 });
    const v0 = r1.version;
    r1.unionInPlace(r2);
    expect(tuples(r1.getRange(strong()))).toEqual([[0, 10]]);
    expect(tuples(r1.getRange(italic()))).toEqual([[20, 30]]);
    expect(r1.version).toBe(v0);
  });

  it("Test #48 — union of two empties is empty", () => {
    const r1 = newR();
    const r2 = newR();
    const r3 = r1.union(r2);
    expect(r3.empty).toBe(true);
    expect(r3.size).toBe(0);
    expect(r3.version).toBe(0);
  });

  it("Test #49 — union with self (non-mutating)", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(italic(), { start: 10, end: 15 });
    const v0 = r1.version;
    const r2 = r1.union(r1);
    expect(orderedKeys(r2)).toEqual(orderedKeys(r1));
    expect(tuples(r2.getRange(strong()))).toEqual(tuples(r1.getRange(strong())));
    expect(tuples(r2.getRange(italic()))).toEqual(tuples(r1.getRange(italic())));
    expect(r2.version).toBe(0);
    expect(r1.version).toBe(v0);
  });

  it("Test #49 (mutating) — union(self, self) MUST NOT bump version", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(italic(), { start: 10, end: 15 });
    const v0 = r1.version;
    r1.unionInPlace(r1);
    expect(r1.version).toBe(v0);
    expect(orderedKeys(r1)).toEqual(["strong", "italic"]);
  });

  it("Test #50 — insertion-order tail-append in other's order", () => {
    type Tag = { name: string };
    const tagKey = (t: Tag): string => t.name;
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const D = { name: "D" };
    const r1 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(A, { start: 0, end: 1 })
      .insert(B, { start: 2, end: 3 });
    const r2 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(C, { start: 4, end: 5 })
      .insert(B, { start: 10, end: 11 })
      .insert(D, { start: 12, end: 13 });
    const r3 = r1.union(r2);
    const order: string[] = [];
    for (const [el] of r3) order.push(el.name);
    expect(order).toEqual(["A", "B", "C", "D"]);
  });

  it("unionInPlace returns this for chaining", () => {
    const r1 = newR();
    const r2 = newR().insert(strong(), { start: 0, end: 5 });
    const out = r1.unionInPlace(r2);
    expect(out).toBe(r1);
  });

  it("non-mutating union does not modify operands", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 5 });
    const r2 = newR().insert(italic(), { start: 10, end: 15 });
    r1.union(r2);
    expect(orderedKeys(r1)).toEqual(["strong"]);
    expect(orderedKeys(r2)).toEqual(["italic"]);
  });

  it("unionInPlace with empty other is a no-op", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 5 });
    const v0 = r1.version;
    r1.unionInPlace(newR());
    expect(r1.version).toBe(v0);
    expect(tuples(r1.getRange(strong()))).toEqual([[0, 5]]);
  });

  it("unionInPlace mutating with new key bumps version once", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 5 });
    const r2 = newR().insert(italic(), { start: 10, end: 15 });
    const v0 = r1.version;
    r1.unionInPlace(r2);
    expect(r1.version).toBe(v0 + 1);
    expect(orderedKeys(r1)).toEqual(["strong", "italic"]);
  });
});

// ------------------------------------------------------------------------ //
// 10.D — intersection (RFC §6.11)
// ------------------------------------------------------------------------ //

describe("RFC §10.D — intersection", () => {
  it("Test #51 — no shared keys", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(italic(), { start: 5, end: 15 });
    const r3 = r1.intersection(r2);
    expect(r3.empty).toBe(true);
  });

  it("Test #52 — shared key, overlapping intervals", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 5, end: 15 });
    const r3 = r1.intersection(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([[5, 10]]);
    expect(r3.size).toBe(1);
  });

  it("Test #53 — shared key, disjoint intervals → element pruned", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 5 });
    const r2 = newR().insert(strong(), { start: 100, end: 200 });
    const r3 = r1.intersection(r2);
    expect(r3.empty).toBe(true);
    expect(r3.getRange(strong())).toEqual([]);
  });

  it("Test #54 — intersection with self", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(italic(), { start: 10, end: 15 });
    const v0 = r1.version;
    const r2 = r1.intersection(r1);
    expect(orderedKeys(r2)).toEqual(orderedKeys(r1));
    expect(tuples(r2.getRange(strong()))).toEqual(tuples(r1.getRange(strong())));
    expect(tuples(r2.getRange(italic()))).toEqual(tuples(r1.getRange(italic())));
    expect(r2.version).toBe(0);
    expect(r1.version).toBe(v0);
  });

  it("Test #55 — intersection with empty container", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(italic(), { start: 10, end: 15 });
    const r2 = newR();
    const r3 = r1.intersection(r2);
    expect(r3.empty).toBe(true);
  });

  it("Test #56 — multiple sub-intervals per element", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(strong(), { start: 10, end: 15 })
      .insert(strong(), { start: 20, end: 25 });
    const r2 = newR().insert(strong(), { start: 3, end: 22 });
    const r3 = r1.intersection(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([
      [3, 5],
      [10, 15],
      [20, 22],
    ]);
  });

  it("Test #57 — insertion-order preservation + dense ord renumber", () => {
    type Tag = { name: string };
    const tagKey = (t: Tag): string => t.name;
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const D = { name: "D" };
    const E = { name: "E" };
    const r1 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(A, { start: 0, end: 5 })
      .insert(B, { start: 10, end: 15 })
      .insert(C, { start: 20, end: 25 })
      .insert(D, { start: 30, end: 35 });
    const r2 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(A, { start: 0, end: 5 })
      .insert(C, { start: 21, end: 24 })
      .insert(E, { start: 100, end: 200 });
    const r3 = r1.intersection(r2);
    const order: string[] = [];
    for (const [el] of r3) order.push(el.name);
    expect(order).toEqual(["A", "C"]);
    expect(tuples(r3.getRange(A))).toEqual([[0, 5]]);
    expect(tuples(r3.getRange(C))).toEqual([[21, 24]]);
    // Dense ord: shared coord stack-up shows order
    r3.insert(A, { start: 500, end: 500 });
    r3.insert(C, { start: 500, end: 500 });
    const slot = r3.at(500).objs.map((t) => t.name);
    expect(slot).toEqual(["A", "C"]);
  });

  it("intersectInPlace mutating: idempotent self bump suppressed", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(italic(), { start: 10, end: 15 });
    const v0 = r1.version;
    r1.intersectInPlace(r1);
    expect(r1.version).toBe(v0);
    expect(orderedKeys(r1)).toEqual(["strong", "italic"]);
  });

  it("intersectInPlace mutating: shrinks self and bumps", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 10 })
      .insert(italic(), { start: 20, end: 30 });
    const r2 = newR().insert(strong(), { start: 5, end: 7 });
    const v0 = r1.version;
    r1.intersectInPlace(r2);
    expect(orderedKeys(r1)).toEqual(["strong"]);
    expect(tuples(r1.getRange(strong()))).toEqual([[5, 7]]);
    expect(r1.version).toBe(v0 + 1);
  });

  it("intersectInPlace returns this", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 5 });
    const r2 = newR().insert(strong(), { start: 0, end: 5 });
    expect(r1.intersectInPlace(r2)).toBe(r1);
  });

  it("non-mutating intersection does not modify operands", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 5, end: 15 });
    r1.intersection(r2);
    expect(tuples(r1.getRange(strong()))).toEqual([[0, 10]]);
    expect(tuples(r2.getRange(strong()))).toEqual([[5, 15]]);
  });
});

// ------------------------------------------------------------------------ //
// 10.E — difference (RFC §6.12)
// ------------------------------------------------------------------------ //

describe("RFC §10.E — difference", () => {
  it("Test #58 — disjoint elements: structurally equal to self", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(italic(), { start: 5, end: 15 });
    const r3 = r1.difference(r2);
    expect(orderedKeys(r3)).toEqual(["strong"]);
    expect(tuples(r3.getRange(strong()))).toEqual([[0, 10]]);
    expect(r3.version).toBe(0);
  });

  it("Test #59 — difference with self is empty", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 10 })
      .insert(italic(), { start: 20, end: 30 });
    const r2 = r1.difference(r1);
    expect(r2.empty).toBe(true);
    expect(r2.size).toBe(0);
  });

  it("Test #60 — left residual", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 5, end: 100 });
    const r3 = r1.difference(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([[0, 4]]);
  });

  it("Test #61 — right residual", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: -100, end: 5 });
    const r3 = r1.difference(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([[6, 10]]);
  });

  it("Test #62 — split into two residuals", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 3, end: 6 });
    const r3 = r1.difference(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([
      [0, 2],
      [7, 10],
    ]);
  });

  it("Test #63 — multi-entry sweep", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(strong(), { start: 10, end: 15 })
      .insert(strong(), { start: 20, end: 25 });
    const r2 = newR().insert(strong(), { start: 3, end: 22 });
    const r3 = r1.difference(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([
      [0, 2],
      [23, 25],
    ]);
  });

  it("Test #64 — insertion-order preservation", () => {
    type Tag = { name: string };
    const tagKey = (t: Tag): string => t.name;
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const D = { name: "D" };
    const E = { name: "E" };
    const r1 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(A, { start: 0, end: 5 })
      .insert(B, { start: 10, end: 15 })
      .insert(C, { start: 20, end: 25 })
      .insert(D, { start: 30, end: 35 });
    const r2 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(B, { start: 9, end: 16 })
      .insert(E, { start: 100, end: 200 });
    const r3 = r1.difference(r2);
    const order: string[] = [];
    for (const [el] of r3) order.push(el.name);
    expect(order).toEqual(["A", "C", "D"]);
  });

  it("Test #65 — difference ≡ removeRanges-loop equivalence (cross-validation)", () => {
    // NOTE on the fixture choice: the RFC §10.E #65 verbatim fixture
    // uses cuts on both Strong and Italic, but the removeRanges-loop
    // equivalence in §6.12 flattens *all* of r2's intervals and would
    // cross-pollinate (Strong's cut would also slice Italic, etc.).
    // `difference` is per-element. To keep the structural-equivalence
    // probe meaningful on the single-key case (the RFC's normative
    // invariant), we place Italic far enough that r2's cut range does
    // not overlap it. Mirrors Ruby's `test_e65` framing.
    const r1 = newR()
      .insert(strong(), { start: 0, end: 10 })
      .insert(italic(), { start: 50, end: 60 });
    const r2 = newR().insert(strong(), { start: 3, end: 6 });
    const r3 = r1.difference(r2);
    const r4 = r1.copy();
    for (const [, ivs] of r2) {
      for (const iv of ivs) r4.removeRanges({ start: iv.lo, end: iv.hi });
    }
    expect(orderedKeys(r3)).toEqual(orderedKeys(r4));
    expect(tuples(r3.getRange(strong()))).toEqual(tuples(r4.getRange(strong())));
    expect(tuples(r3.getRange(italic()))).toEqual(tuples(r4.getRange(italic())));
  });

  it("subtractInPlace returns this for chaining", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 5, end: 6 });
    expect(r1.subtractInPlace(r2)).toBe(r1);
  });

  it("subtractInPlace empties self when subtracting self", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const v0 = r1.version;
    r1.subtractInPlace(r1);
    expect(r1.empty).toBe(true);
    expect(r1.version).toBe(v0 + 1);
  });

  it("subtractInPlace on already-empty self is no-op", () => {
    const r1 = newR();
    const v0 = r1.version;
    r1.subtractInPlace(r1);
    expect(r1.empty).toBe(true);
    expect(r1.version).toBe(v0);
  });

  it("non-mutating difference does not modify operands", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 5, end: 6 });
    r1.difference(r2);
    expect(tuples(r1.getRange(strong()))).toEqual([[0, 10]]);
    expect(tuples(r2.getRange(strong()))).toEqual([[5, 6]]);
  });
});

// ------------------------------------------------------------------------ //
// 10.F — symmetric difference (RFC §6.13)
// ------------------------------------------------------------------------ //

describe("RFC §10.F — symmetricDifference", () => {
  it("Test #66 — sym-diff with empty equals self structurally", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(italic(), { start: 10, end: 15 });
    const r2 = newR();
    const r3 = r1.symmetricDifference(r2);
    expect(orderedKeys(r3)).toEqual(["strong", "italic"]);
    expect(tuples(r3.getRange(strong()))).toEqual([[0, 5]]);
    expect(tuples(r3.getRange(italic()))).toEqual([[10, 15]]);
    expect(r3.version).toBe(0);
  });

  it("Test #67 — sym-diff with self is empty", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(italic(), { start: 10, end: 15 });
    const r2 = r1.symmetricDifference(r1);
    expect(r2.empty).toBe(true);
    expect(r2.size).toBe(0);
  });

  it("Test #68 — per-element residuals from both sides", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 5, end: 15 });
    const r3 = r1.symmetricDifference(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([
      [0, 4],
      [11, 15],
    ]);
  });

  it("adjacency case — RFC §6.13 worked example: two-side residuals collapse", () => {
    // R_self = [(0,5)], R_other = [(6,10)]; merge MUST collapse to [(0,10)]
    const r1 = newR().insert(strong(), { start: 0, end: 5 });
    const r2 = newR().insert(strong(), { start: 6, end: 10 });
    const r3 = r1.symmetricDifference(r2);
    expect(tuples(r3.getRange(strong()))).toEqual([[0, 10]]);
  });

  it("Test #69 — commutativity (per-element R(e) is identical, insertion_order may differ)", () => {
    type Tag = { name: string };
    const tagKey = (t: Tag): string => t.name;
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const r1 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(A, { start: 0, end: 5 })
      .insert(B, { start: 10, end: 15 });
    const r2 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(B, { start: 12, end: 17 })
      .insert(C, { start: 20, end: 25 });
    const r3 = r1.symmetricDifference(r2);
    const r4 = r2.symmetricDifference(r1);
    expect(tuples(r3.getRange(A))).toEqual(tuples(r4.getRange(A)));
    expect(tuples(r3.getRange(B))).toEqual(tuples(r4.getRange(B)));
    expect(tuples(r3.getRange(C))).toEqual(tuples(r4.getRange(C)));
    // Insertion order is self-primary
    const o3: string[] = [];
    for (const [el] of r3) o3.push(el.name);
    const o4: string[] = [];
    for (const [el] of r4) o4.push(el.name);
    expect(o3).toEqual(["A", "B", "C"]);
    expect(o4).toEqual(["B", "C", "A"]);
    // Per-element check
    expect(tuples(r3.getRange(A))).toEqual([[0, 5]]);
    expect(tuples(r3.getRange(B))).toEqual([
      [10, 11],
      [16, 17],
    ]);
    expect(tuples(r3.getRange(C))).toEqual([[20, 25]]);
  });

  it("Test #70 — associativity: R(A) = [(0,4), (10,10), (16,20)]", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 5, end: 15 });
    const r3 = newR().insert(strong(), { start: 10, end: 20 });
    const left = r1.symmetricDifference(r2).symmetricDifference(r3);
    const right = r1.symmetricDifference(r2.symmetricDifference(r3));
    const expected = [
      [0, 4],
      [10, 10],
      [16, 20],
    ];
    expect(tuples(left.getRange(strong()))).toEqual(expected);
    expect(tuples(right.getRange(strong()))).toEqual(expected);
    expect(orderedKeys(left)).toEqual(["strong"]);
    expect(orderedKeys(right)).toEqual(["strong"]);
  });

  it("Test #71 — insertion-order tail-append for keys ∈ other ∖ self", () => {
    type Tag = { name: string };
    const tagKey = (t: Tag): string => t.name;
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const D = { name: "D" };
    const r1 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(A, { start: 0, end: 5 })
      .insert(B, { start: 10, end: 15 });
    const r2 = new Rangeable<Tag>({ keyFn: tagKey })
      .insert(C, { start: 20, end: 25 })
      .insert(D, { start: 30, end: 35 });
    const r3 = r1.symmetricDifference(r2);
    const order: string[] = [];
    for (const [el] of r3) order.push(el.name);
    expect(order).toEqual(["A", "B", "C", "D"]);
  });

  it("symmetricDifferenceInPlace returns this", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 5 });
    const r2 = newR().insert(italic(), { start: 10, end: 15 });
    expect(r1.symmetricDifferenceInPlace(r2)).toBe(r1);
  });

  it("symmetricDifferenceInPlace with self empties self", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 5 })
      .insert(italic(), { start: 10, end: 15 });
    const v0 = r1.version;
    r1.symmetricDifferenceInPlace(r1);
    expect(r1.empty).toBe(true);
    expect(r1.version).toBe(v0 + 1);
  });

  it("symmetricDifferenceInPlace on empty self with empty other is no-op", () => {
    const r1 = newR();
    const v0 = r1.version;
    r1.symmetricDifferenceInPlace(r1);
    expect(r1.empty).toBe(true);
    expect(r1.version).toBe(v0);
  });

  it("symmetricDifferenceInPlace mutates self when result differs", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(strong(), { start: 5, end: 15 });
    const v0 = r1.version;
    r1.symmetricDifferenceInPlace(r2);
    expect(tuples(r1.getRange(strong()))).toEqual([
      [0, 4],
      [11, 15],
    ]);
    expect(r1.version).toBe(v0 + 1);
  });
});

// ------------------------------------------------------------------------ //
// 10.G — set-op insertion-order stress tests
// ------------------------------------------------------------------------ //

describe("RFC §10.G — set-op insertion-order stress tests", () => {
  type Tag = { name: string };
  const tagKey = (t: Tag): string => t.name;
  const newRT = () => new Rangeable<Tag>({ keyFn: tagKey });

  it("Test #72 — multi-element prune cascades and renumbers", () => {
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const D = { name: "D" };
    const E = { name: "E" };
    const r1 = newRT()
      .insert(A, { start: 0, end: 1 })
      .insert(B, { start: 2, end: 3 })
      .insert(C, { start: 4, end: 5 })
      .insert(D, { start: 6, end: 7 })
      .insert(E, { start: 8, end: 9 });
    const r2 = newRT()
      .insert(B, { start: 100, end: 200 })
      .insert(D, { start: 100, end: 200 });
    const r3 = r1.intersection(r2);
    expect(r3.empty).toBe(true);
    expect(r3.size).toBe(0);
  });

  it("Test #73 — union then intersect preserves insertion_order", () => {
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const r1 = newRT()
      .insert(A, { start: 0, end: 5 })
      .insert(B, { start: 10, end: 15 });
    const r2 = newRT()
      .insert(C, { start: 20, end: 25 })
      .insert(B, { start: 12, end: 17 });
    const r3 = newRT()
      .insert(B, { start: 0, end: 100 })
      .insert(C, { start: 0, end: 100 });
    const inter = r1.union(r2).intersection(r3);
    const order: string[] = [];
    for (const [el] of inter) order.push(el.name);
    expect(order).toEqual(["B", "C"]);
  });

  it("Test #74 — set-op result ord is correct after input pruning", () => {
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const r1 = newRT()
      .insert(A, { start: 0, end: 5 })
      .insert(B, { start: 10, end: 15 })
      .insert(C, { start: 20, end: 25 });
    r1.removeElement(B);
    const r2 = r1.union(newRT());
    const order: string[] = [];
    for (const [el] of r2) order.push(el.name);
    expect(order).toEqual(["A", "C"]);
  });

  it("Test #75 — difference then union recovers insertion_order", () => {
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const r1 = newRT()
      .insert(A, { start: 0, end: 10 })
      .insert(B, { start: 20, end: 30 })
      .insert(C, { start: 40, end: 50 });
    const r2 = newRT().insert(B, { start: 0, end: 100 });
    const r3 = r1.difference(r2).union(r1);
    const order: string[] = [];
    for (const [el] of r3) order.push(el.name);
    expect(order).toEqual(["A", "C", "B"]);
  });

  it("Test #76 — union of three with overlapping keys", () => {
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const D = { name: "D" };
    const r1 = newRT()
      .insert(A, { start: 0, end: 5 })
      .insert(B, { start: 10, end: 15 });
    const r2 = newRT()
      .insert(B, { start: 20, end: 25 })
      .insert(C, { start: 30, end: 35 });
    const r3 = newRT()
      .insert(C, { start: 40, end: 45 })
      .insert(D, { start: 50, end: 55 });
    const chain = r1.union(r2).union(r3);
    const order: string[] = [];
    for (const [el] of chain) order.push(el.name);
    expect(order).toEqual(["A", "B", "C", "D"]);
    expect(tuples(chain.getRange(A))).toEqual([[0, 5]]);
    expect(tuples(chain.getRange(B))).toEqual([
      [10, 15],
      [20, 25],
    ]);
    expect(tuples(chain.getRange(C))).toEqual([
      [30, 35],
      [40, 45],
    ]);
    expect(tuples(chain.getRange(D))).toEqual([[50, 55]]);
  });

  it("Test #77 — sym-diff two algebraic-form per-element equivalence", () => {
    const r1 = newR()
      .insert(strong(), { start: 0, end: 10 })
      .insert(italic(), { start: 20, end: 30 });
    const r2 = newR()
      .insert(strong(), { start: 5, end: 15 })
      .insert(code(), { start: 40, end: 50 });
    const form1 = r1.symmetricDifference(r2);
    const form2 = r1.union(r2).difference(r1.intersection(r2));
    // Per-element identical (insertion_order may differ between forms)
    expect(tuples(form1.getRange(strong()))).toEqual(tuples(form2.getRange(strong())));
    expect(tuples(form1.getRange(italic()))).toEqual(tuples(form2.getRange(italic())));
    expect(tuples(form1.getRange(code()))).toEqual(tuples(form2.getRange(code())));
  });

  it("Test #79 — cross-op ord consistency (intersect after union)", () => {
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    const D = { name: "D" };
    const r1 = newRT()
      .insert(A, { start: 0, end: 5 })
      .insert(B, { start: 10, end: 15 })
      .insert(C, { start: 20, end: 25 });
    const r2 = newRT()
      .insert(B, { start: 12, end: 17 })
      .insert(D, { start: 30, end: 35 });
    const rUnion = r1.union(r2);
    const rOrder: string[] = [];
    for (const [el] of rUnion) rOrder.push(el.name);
    expect(rOrder).toEqual(["A", "B", "C", "D"]);
    const r3 = newRT()
      .insert(B, { start: 0, end: 100 })
      .insert(D, { start: 0, end: 100 })
      .insert(A, { start: 0, end: 100 });
    const rIntersect = rUnion.intersection(r3);
    const iOrder: string[] = [];
    for (const [el] of rIntersect) iOrder.push(el.name);
    expect(iOrder).toEqual(["A", "B", "D"]);
  });

  it("Test #80 — empty result eager-prune across set-op chain", () => {
    const A = { name: "A" };
    const B = { name: "B" };
    const r1 = newRT()
      .insert(A, { start: 0, end: 5 })
      .insert(B, { start: 10, end: 15 });
    const r2 = newRT()
      .insert(A, { start: 100, end: 200 })
      .insert(B, { start: 100, end: 200 });
    const r3 = r1.intersection(r2);
    expect(r3.empty).toBe(true);
    const r4 = r3.union(r1);
    const order: string[] = [];
    for (const [el] of r4) order.push(el.name);
    expect(order).toEqual(["A", "B"]);
  });
});

// ------------------------------------------------------------------------ //
// JS-specific: keyFn mismatch (RFC §9 case 36)
// ------------------------------------------------------------------------ //

describe("JS-specific: keyFn mismatch (RFC §9 case 36)", () => {
  it("union throws RangeableError when keyFn differs", () => {
    const r1 = new Rangeable<Markup>({ keyFn });
    const r2 = new Rangeable<Markup>({ keyFn: (m) => `xx:${keyFn(m)}` });
    expect(() => r1.union(r2)).toThrow(RangeableError);
  });

  it("intersection throws RangeableError when keyFn differs", () => {
    const r1 = new Rangeable<Markup>({ keyFn });
    const r2 = new Rangeable<Markup>({ keyFn: (m) => `xx:${keyFn(m)}` });
    expect(() => r1.intersection(r2)).toThrow(RangeableError);
  });

  it("difference throws RangeableError when keyFn differs", () => {
    const r1 = new Rangeable<Markup>({ keyFn });
    const r2 = new Rangeable<Markup>({ keyFn: (m) => `xx:${keyFn(m)}` });
    expect(() => r1.difference(r2)).toThrow(RangeableError);
  });

  it("symmetricDifference throws RangeableError when keyFn differs", () => {
    const r1 = new Rangeable<Markup>({ keyFn });
    const r2 = new Rangeable<Markup>({ keyFn: (m) => `xx:${keyFn(m)}` });
    expect(() => r1.symmetricDifference(r2)).toThrow(RangeableError);
  });

  it("unionInPlace throws RangeableError when keyFn differs", () => {
    const r1 = new Rangeable<Markup>({ keyFn });
    const r2 = new Rangeable<Markup>({ keyFn: (m) => `xx:${keyFn(m)}` });
    expect(() => r1.unionInPlace(r2)).toThrow(RangeableError);
  });

  it("intersectInPlace throws RangeableError when keyFn differs", () => {
    const r1 = new Rangeable<Markup>({ keyFn });
    const r2 = new Rangeable<Markup>({ keyFn: (m) => `xx:${keyFn(m)}` });
    expect(() => r1.intersectInPlace(r2)).toThrow(RangeableError);
  });

  it("subtractInPlace throws RangeableError when keyFn differs", () => {
    const r1 = new Rangeable<Markup>({ keyFn });
    const r2 = new Rangeable<Markup>({ keyFn: (m) => `xx:${keyFn(m)}` });
    expect(() => r1.subtractInPlace(r2)).toThrow(RangeableError);
  });

  it("symmetricDifferenceInPlace throws RangeableError when keyFn differs", () => {
    const r1 = new Rangeable<Markup>({ keyFn });
    const r2 = new Rangeable<Markup>({ keyFn: (m) => `xx:${keyFn(m)}` });
    expect(() => r1.symmetricDifferenceInPlace(r2)).toThrow(RangeableError);
  });
});

// ------------------------------------------------------------------------ //
// JS-specific: intMaxSentinel propagation (RFC §9 case 37)
// ------------------------------------------------------------------------ //

describe("JS-specific: intMaxSentinel propagation (RFC §9 case 37)", () => {
  const intMax = (2 ** 31) - 1;
  const buildSentinel = (): Rangeable<Markup> =>
    new Rangeable<Markup>({ keyFn, intMaxSentinel: intMax });

  it("union propagates the sentinel into the result", () => {
    const r1 = buildSentinel().insert(strong(), { start: 100, end: intMax });
    const r2 = buildSentinel().insert(italic(), { start: 50, end: 60 });
    const r3 = r1.union(r2);
    const events = r3.transitions({ from: 0, to: intMax });
    // Strong still ends at +∞ in the result
    const closeStrong = events.find(
      (e) => e.kind === "close" && keyFn(e.element) === "strong",
    );
    expect(closeStrong).toBeDefined();
    expect(closeStrong!.coordinate).toBeNull();
  });

  it("intersection propagates the sentinel into the result", () => {
    const r1 = buildSentinel().insert(strong(), { start: 100, end: intMax });
    const r2 = buildSentinel().insert(strong(), { start: 200, end: intMax });
    const r3 = r1.intersection(r2);
    const events = r3.transitions({ from: 0, to: intMax });
    const closeStrong = events.find(
      (e) => e.kind === "close" && keyFn(e.element) === "strong",
    );
    expect(closeStrong).toBeDefined();
    expect(closeStrong!.coordinate).toBeNull();
  });

  it("difference propagates the sentinel into the result", () => {
    const r1 = buildSentinel().insert(strong(), { start: 100, end: intMax });
    const r2 = buildSentinel().insert(strong(), { start: 200, end: 300 });
    const r3 = r1.difference(r2);
    const events = r3.transitions({ from: 0, to: intMax });
    // Final close coord for the right residual remains +∞
    const lastClose = [...events]
      .reverse()
      .find((e) => e.kind === "close" && keyFn(e.element) === "strong");
    expect(lastClose).toBeDefined();
    expect(lastClose!.coordinate).toBeNull();
  });

  it("symmetricDifference propagates the sentinel into the result", () => {
    const r1 = buildSentinel().insert(strong(), { start: 100, end: intMax });
    const r2 = buildSentinel().insert(strong(), { start: 50, end: 90 });
    const r3 = r1.symmetricDifference(r2);
    const events = r3.transitions({ from: 0, to: intMax });
    const closeStrong = [...events]
      .reverse()
      .find((e) => e.kind === "close" && keyFn(e.element) === "strong");
    expect(closeStrong).toBeDefined();
    expect(closeStrong!.coordinate).toBeNull();
  });

  it("non-sentinel container stays non-sentinel after set ops", () => {
    const r1 = newR().insert(strong(), { start: 0, end: 10 });
    const r2 = newR().insert(italic(), { start: 5, end: 15 });
    const r3 = r1.union(r2);
    // Without a sentinel, the close coord is hi+1 (a finite number).
    const events = r3.transitions({ from: 0, to: 100 });
    expect(events.every((e) => e.coordinate !== null)).toBe(true);
  });
});
