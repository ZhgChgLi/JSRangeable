/**
 * RFC §10 Test #20 — random insert + brute-force oracle parity.
 *
 * Uses a seeded Mulberry32 PRNG so the random sequence is reproducible
 * across runs (and, in principle, across language ports — though each
 * language tracks its own seeded ops; the cross-language byte-identical
 * fixture is in `crossLanguage.test.ts`).
 */

import { describe, expect, it } from "vitest";

import { Rangeable } from "../src/index.js";

interface Strong { kind: "strong"; }
interface Italic { kind: "italic"; }
interface Code { kind: "code"; }
interface Link { kind: "link"; url: string; }
type Markup = Strong | Italic | Code | Link;

const keyFn = (m: Markup): string =>
  m.kind === "link" ? `link:${m.url}` : m.kind;

const ELEMENTS: Markup[] = [
  { kind: "strong" },
  { kind: "italic" },
  { kind: "code" },
  { kind: "link", url: "x" },
  { kind: "link", url: "y" },
];

const COORD_BOUND = 200;
const N_OPS = 1000;
const SEED = 42;

/** Mulberry32 — small, fast seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

interface Op { e: Markup; lo: number; hi: number; }

function buildFirstSeen(ops: Op[]): Map<string, number> {
  const seen = new Map<string, number>();
  ops.forEach((op, idx) => {
    const k = keyFn(op.e);
    if (!seen.has(k)) seen.set(k, idx);
  });
  return seen;
}

function bruteForceActive(ops: Op[], firstSeen: Map<string, number>, i: number): Markup[] {
  const active = new Map<string, Markup>();
  for (const op of ops) {
    if (op.lo <= i && i <= op.hi) {
      const k = keyFn(op.e);
      if (!active.has(k)) active.set(k, op.e);
    }
  }
  const keys = Array.from(active.keys());
  keys.sort((a, b) => firstSeen.get(a)! - firstSeen.get(b)!);
  return keys.map((k) => active.get(k)!);
}

describe("property test against brute-force oracle", () => {
  it("random inserts produce active sets identical to brute force", () => {
    const rng = mulberry32(SEED);
    const ops: Op[] = [];
    for (let n = 0; n < N_OPS; n += 1) {
      const e = ELEMENTS[randInt(rng, 0, ELEMENTS.length - 1)]!;
      const lo = randInt(rng, -COORD_BOUND, COORD_BOUND);
      const hi = lo + randInt(rng, 0, 30);
      ops.push({ e, lo, hi });
    }

    const r = new Rangeable<Markup>({ keyFn });
    for (const op of ops) r.insert(op.e, { start: op.lo, end: op.hi });

    const firstSeen = buildFirstSeen(ops);
    let failures = 0;
    let sample: { i: number; expected: Markup[]; actual: readonly Markup[] } | null = null;
    for (let i = -COORD_BOUND; i <= COORD_BOUND; i += 1) {
      const expected = bruteForceActive(ops, firstSeen, i);
      const actual = r.at(i).objs;
      if (
        actual.length !== expected.length ||
        actual.some((e, idx) => keyFn(e) !== keyFn(expected[idx]!))
      ) {
        failures += 1;
        if (sample === null) sample = { i, expected, actual };
      }
    }
    expect(failures, `first mismatch=${JSON.stringify(sample)}`).toBe(0);
  });
});
