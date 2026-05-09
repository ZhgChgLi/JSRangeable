/**
 * RFC §10 — 23 normative contract tests.
 *
 * Mirrors the Ruby reference (`RubyRangeable/test/rangeable_test.rb`) and
 * the Swift `RangeableContractTests`. Test #20 (random property) is in
 * `property.test.ts`. Test #23.A (Int.max sentinel) is exercised via
 * the optional `intMaxSentinel` constructor option, since JS numbers
 * don't have a native Int.max.
 */

import { describe, expect, it } from "vitest";

import {
  InvalidIntervalError,
  Rangeable,
  type TransitionKind,
} from "../src/index.js";

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

const eventTuples = (events: { coordinate: number | null; kind: TransitionKind; element: Markup }[]) =>
  events.map((e) => [e.coordinate, e.kind, e.element] as const);

// ------------------------------------------------------------------------ //

describe("RFC §10 contract tests", () => {
  it("Test #1 — empty container", () => {
    const r = newR();
    expect(r.at(0).objs).toEqual([]);
    expect(r.getRange(strong())).toEqual([]);
    expect(r.size).toBe(0);
    expect(r.empty).toBe(true);
  });

  it("Test #2 — single insert", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 5 });
    expect(r.at(2).objs).toEqual([strong()]);
    expect(r.at(5).objs).toEqual([strong()]);
    expect(r.at(6).objs).toEqual([]);
    expect(r.at(1).objs).toEqual([]);
  });

  it("Test #3 — inclusive end", () => {
    const r = newR();
    r.insert(strong(), { start: 3, end: 8 });
    expect(r.at(8).objs).toEqual([strong()]);
    expect(r.at(9).objs).toEqual([]);
  });

  it("Test #4 — single-point", () => {
    const r = newR();
    r.insert(strong(), { start: 4, end: 4 });
    expect(r.at(3).objs).toEqual([]);
    expect(r.at(4).objs).toEqual([strong()]);
    expect(r.at(5).objs).toEqual([]);
  });

  it("Test #5 — same-element overlap merge", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 5 });
    r.insert(strong(), { start: 3, end: 7 });
    expect(r.getRange(strong()).map((iv) => iv.toTuple())).toEqual([[2, 7]]);
  });

  it("Test #6 — same-element adjacency merge", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 4 });
    r.insert(strong(), { start: 5, end: 7 });
    expect(r.getRange(strong()).map((iv) => iv.toTuple())).toEqual([[2, 7]]);
  });

  it("Test #7 — same-element non-adjacent disjoint", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 4 });
    r.insert(strong(), { start: 6, end: 7 });
    expect(r.getRange(strong()).map((iv) => iv.toTuple())).toEqual([
      [2, 4],
      [6, 7],
    ]);
  });

  it("Test #8 — same-element nested", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 10 });
    r.insert(strong(), { start: 4, end: 6 });
    expect(r.getRange(strong()).map((iv) => iv.toTuple())).toEqual([[2, 10]]);
  });

  it("Test #9 — idempotent insert", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 5 });
    const v1 = r.version;
    r.insert(strong(), { start: 2, end: 5 });
    expect(r.getRange(strong()).map((iv) => iv.toTuple())).toEqual([[2, 5]]);
    expect(r.version).toBe(v1);
  });

  it("Test #10 — different elements coexist", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 5 });
    r.insert(italic(), { start: 3, end: 7 });
    expect(r.at(3).objs).toEqual([strong(), italic()]);
    expect(r.at(6).objs).toEqual([italic()]);
    expect(r.getRange(strong()).map((iv) => iv.toTuple())).toEqual([[2, 5]]);
    expect(r.getRange(italic()).map((iv) => iv.toTuple())).toEqual([[3, 7]]);
  });

  it("Test #11 — equal-by-key elements merge", () => {
    const r = newR();
    r.insert(link("a"), { start: 2, end: 5 });
    r.insert(link("a"), { start: 4, end: 8 });
    r.insert(link("b"), { start: 6, end: 9 });
    expect(r.getRange(link("a")).map((iv) => iv.toTuple())).toEqual([[2, 8]]);
    expect(r.getRange(link("b")).map((iv) => iv.toTuple())).toEqual([[6, 9]]);
  });

  it("Test #12 — first-insert order at point", () => {
    const r = newR();
    r.insert(strong(), { start: 1, end: 10 });
    r.insert(italic(), { start: 1, end: 10 });
    r.insert(code(), { start: 1, end: 10 });
    expect(r.at(5).objs).toEqual([strong(), italic(), code()]);
  });

  it("Test #13 — order preserved through merge", () => {
    const r = newR();
    r.insert(strong(), { start: 1, end: 5 });
    r.insert(italic(), { start: 3, end: 7 });
    r.insert(strong(), { start: 4, end: 8 });
    expect(r.at(6).objs).toEqual([strong(), italic()]);
  });

  it("Test #14 — transitions over a range", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 5 });
    r.insert(italic(), { start: 3, end: 7 });
    expect(eventTuples(r.transitions({ from: 0, to: 10 }))).toEqual([
      [2, "open", strong()],
      [3, "open", italic()],
      [6, "close", strong()],
      [8, "close", italic()],
    ]);
  });

  it("Test #15 — transitions same-start", () => {
    const r = newR();
    r.insert(strong(), { start: 3, end: 5 });
    r.insert(italic(), { start: 3, end: 7 });
    expect(eventTuples(r.transitions({ from: 0, to: 10 }))).toEqual([
      [3, "open", strong()],
      [3, "open", italic()],
      [6, "close", strong()],
      [8, "close", italic()],
    ]);
  });

  it("Test #16 — transitions same-end (LIFO close order)", () => {
    const r = newR();
    r.insert(strong(), { start: 3, end: 5 });
    r.insert(italic(), { start: 3, end: 5 });
    expect(eventTuples(r.transitions({ from: 0, to: 10 }))).toEqual([
      [3, "open", strong()],
      [3, "open", italic()],
      [6, "close", italic()],
      [6, "close", strong()],
    ]);
  });

  it("Test #17 — start > end throws", () => {
    const r = newR();
    expect(() => r.insert(strong(), { start: 5, end: 2 })).toThrow(InvalidIntervalError);
    expect(r.empty).toBe(true);
  });

  it("Test #18 — negative start", () => {
    const r = newR();
    r.insert(strong(), { start: -2, end: 3 });
    expect(r.at(-1).objs).toEqual([strong()]);
    expect(r.at(0).objs).toEqual([strong()]);
    expect(r.at(3).objs).toEqual([strong()]);
    expect(r.at(4).objs).toEqual([]);
  });

  it("Test #19 — insert/read interleave (rebuild correctness)", () => {
    const r = newR();
    r.insert(strong(), { start: 1, end: 3 });
    const read1 = r.at(2).objs;
    r.insert(strong(), { start: 5, end: 7 });
    const read2 = r.at(6).objs;
    expect(read1).toEqual([strong()]);
    expect(read2).toEqual([strong()]);
    expect(r.getRange(strong()).map((iv) => iv.toTuple())).toEqual([
      [1, 3],
      [5, 7],
    ]);
  });

  it("Test #21 — idempotent insert MUST NOT bump version", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 5 });
    const v1 = r.version;
    r.insert(strong(), { start: 2, end: 5 });
    expect(r.version).toBe(v1);
  });

  it("Test #21.A — idempotent insert with strict containment", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 10 });
    const v1 = r.version;
    r.insert(strong(), { start: 4, end: 6 });
    expect(r.getRange(strong()).map((iv) => iv.toTuple())).toEqual([[2, 10]]);
    expect(r.version).toBe(v1);
  });

  it("Test #22 — transitions with from > to throws", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 5 });
    expect(() => r.transitions({ from: 5, to: 2 })).toThrow(InvalidIntervalError);
  });

  it("Test #23 — Int.min simulator as start", () => {
    const intMin = -(2 ** 31);
    const r = newR();
    r.insert(strong(), { start: intMin, end: intMin + 5 });
    expect(r.at(intMin).objs).toEqual([strong()]);
    expect(r.at(intMin + 5).objs).toEqual([strong()]);
    expect(r.at(intMin + 6).objs).toEqual([]);
    expect(r.getRange(strong()).map((iv) => iv.toTuple())).toEqual([
      [intMin, intMin + 5],
    ]);
  });

  it("Test #23.A — intMaxSentinel close coord is null", () => {
    const intMax = (2 ** 31) - 1;
    const r = new Rangeable<Markup>({ keyFn, intMaxSentinel: intMax });
    r.insert(strong(), { start: 100, end: intMax });
    const events = r.transitions({ from: 50, to: intMax });
    expect(events.map((e) => [e.coordinate, e.kind])).toEqual([
      [100, "open"],
      [null, "close"],
    ]);
  });
});

// ------------------------------------------------------------------------ //
// Additional coverage: size / empty / iteration / copy independence
// ------------------------------------------------------------------------ //

describe("collection-style API", () => {
  it("size and empty track distinct elements", () => {
    const r = newR();
    expect(r.size).toBe(0);
    expect(r.empty).toBe(true);
    r.insert(strong(), { start: 1, end: 2 });
    expect(r.size).toBe(1);
    expect(r.empty).toBe(false);
    r.insert(strong(), { start: 3, end: 4 }); // same equivalence class
    expect(r.size).toBe(1);
    r.insert(italic(), { start: 1, end: 2 });
    expect(r.size).toBe(2);
  });

  it("iteration yields pairs in first-insert order", () => {
    const r = newR();
    r.insert(italic(), { start: 3, end: 4 });
    r.insert(strong(), { start: 1, end: 2 });
    const pairs = [...r].map(([e, ivs]) => [e, ivs.map((iv) => iv.toTuple())]);
    expect(pairs).toEqual([
      [italic(), [[3, 4]]],
      [strong(), [[1, 2]]],
    ]);
  });

  it("copy is deep and independent", () => {
    const r1 = newR();
    r1.insert(strong(), { start: 1, end: 5 });
    const r2 = r1.copy();
    r2.insert(strong(), { start: 10, end: 12 });
    expect(r1.getRange(strong()).map((iv) => iv.toTuple())).toEqual([[1, 5]]);
    expect(r2.getRange(strong()).map((iv) => iv.toTuple())).toEqual([
      [1, 5],
      [10, 12],
    ]);
  });

  it("insert returns this for chaining", () => {
    const r = newR();
    const out = r
      .insert(strong(), { start: 1, end: 2 })
      .insert(italic(), { start: 3, end: 4 });
    expect(out).toBe(r);
  });

  it("transitions with to=null means +∞", () => {
    const r = newR();
    r.insert(strong(), { start: 2, end: 5 });
    const events = r.transitions({ from: 0, to: null });
    expect(events).toHaveLength(2);
    expect(events[1]!.coordinate).toBe(6);
    expect(events[1]!.kind).toBe("close");
  });

  it("constructor throws if keyFn is missing", () => {
    expect(
      () =>
        new Rangeable({
          keyFn: undefined as unknown as (e: unknown) => string,
        }),
    ).toThrow(TypeError);
  });
});
