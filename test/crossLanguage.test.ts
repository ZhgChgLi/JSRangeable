/**
 * Cross-language fixture replay (schema v1 + v2).
 *
 * Consumes the shared `cross_language.json` produced by Ruby
 * (`RubyRangeable/test/cross_language_fixture.rb`) and replayed identically
 * by Swift's `CrossLanguageFixtureTests`, Python's `test_cross_language.py`,
 * Kotlin and Go reference implementations.
 *
 * Schema versions handled:
 *   v1 — no `schema_version`, only `ops` (all `insert`) + `probes`.
 *   v2 — `schema_version: 2`, `ops` may include `remove`/`remove_element`/
 *        `clear`/`remove_ranges`, plus a `set_ops` array. Probes carry an
 *        optional `phase` field that selects which intermediate state they
 *        were computed against (`v1`-style: post all v1 ops only;
 *        `after_removes`: post v1 ops + first 30 `remove` ops only;
 *        `final`: post all 200 ops).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Rangeable } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "fixtures/cross_language.json");

interface Strong { kind: "strong"; }
interface Italic { kind: "italic"; }
interface Code { kind: "code"; }
interface Link { kind: "link"; url: string; }
type Markup = Strong | Italic | Code | Link;

// All Rangeables built by this runner MUST share the same keyFn so that
// non-mutating set ops accept the operands (RFC §6.10–§6.13: same keyFn
// requirement enforced by `_assertSameKeyFn`).
const keyFn = (m: Markup): string =>
  m.kind === "link" ? `link:${m.url}` : m.kind;

const ELEMENT_FACTORY: Array<() => Markup> = [
  () => ({ kind: "strong" }),
  () => ({ kind: "italic" }),
  () => ({ kind: "code" }),
  () => ({ kind: "link", url: "a" }),
  () => ({ kind: "link", url: "b" }),
];

const canonicalKey = (m: Markup): string =>
  m.kind === "link" ? `link:${m.url}` : m.kind;

// -------- Fixture types -------- //

type OpKind =
  | "insert"
  | "remove"
  | "remove_element"
  | "clear"
  | "remove_ranges";

interface Op {
  op?: OpKind; // optional in v1 (defaults to "insert")
  element?: number;
  start?: number;
  end?: number;
}

interface ExpectedEvent {
  coordinate: number | null;
  kind: string;
  element: string;
}

type ProbePhase = "v1" | "after_removes" | "final";

interface SubscriptProbe {
  kind: "subscript";
  i: number;
  expected: string[];
  phase?: ProbePhase;
}
interface TransitionsProbe {
  kind: "transitions";
  lo: number;
  hi: number;
  expected: ExpectedEvent[];
  phase?: ProbePhase;
}
type Probe = SubscriptProbe | TransitionsProbe;

type SetOpName = "union" | "intersect" | "difference" | "symmetric_difference";

interface ExpectedState {
  insertion_order: string[];
  intervals: Record<string, Array<[number, number]>>;
}

interface SetOpEntry {
  id: string;
  op: SetOpName;
  self_ops: Op[];
  other_ops: Op[];
  chain_ops?: Op[];
  expected_state: ExpectedState;
  probes?: Probe[];
}

interface FixtureV1 {
  schema_version?: undefined | 1;
  seed: number;
  ops: Op[];
  probes: Probe[];
}

interface FixtureV2 {
  schema_version: 2;
  seed: number;
  ops: Op[];
  probes: Probe[];
  set_ops: SetOpEntry[];
}

type Fixture = FixtureV1 | FixtureV2;

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const schemaVersion = fixture.schema_version ?? 1;

// -------- Op application -------- //

function applyOp(r: Rangeable<Markup>, op: Op): void {
  const kind: OpKind = op.op ?? "insert";
  switch (kind) {
    case "insert": {
      const e = ELEMENT_FACTORY[op.element!]!();
      r.insert(e, { start: op.start!, end: op.end! });
      return;
    }
    case "remove": {
      const e = ELEMENT_FACTORY[op.element!]!();
      r.remove(e, { start: op.start!, end: op.end! });
      return;
    }
    case "remove_element": {
      const e = ELEMENT_FACTORY[op.element!]!();
      r.removeElement(e);
      return;
    }
    case "clear": {
      r.clear();
      return;
    }
    case "remove_ranges": {
      r.removeRanges({ start: op.start!, end: op.end! });
      return;
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown op kind: ${String(exhaustive)}`);
    }
  }
}

function buildFromOps(ops: Op[]): Rangeable<Markup> {
  const r = new Rangeable<Markup>({ keyFn });
  for (const op of ops) {
    applyOp(r, op);
  }
  return r;
}

// -------- Probe assertions -------- //

function checkSubscriptProbe(
  r: Rangeable<Markup>,
  probe: SubscriptProbe,
  context: string,
): void {
  const actual = r.at(probe.i).objs.map((e) => canonicalKey(e));
  expect(actual, `${context}: subscript i=${probe.i}`).toEqual(probe.expected);
}

function checkTransitionsProbe(
  r: Rangeable<Markup>,
  probe: TransitionsProbe,
  context: string,
): void {
  const events = r.transitions({ from: probe.lo, to: probe.hi });
  const actual = events.map((e) => ({
    coordinate: e.coordinate,
    kind: e.kind,
    element: canonicalKey(e.element),
  }));
  expect(
    actual,
    `${context}: transitions [${probe.lo}..${probe.hi}]`,
  ).toEqual(probe.expected);
}

function checkProbe(
  r: Rangeable<Markup>,
  probe: Probe,
  context: string,
): void {
  if (probe.kind === "subscript") {
    checkSubscriptProbe(r, probe, context);
  } else {
    checkTransitionsProbe(r, probe, context);
  }
}

// -------- Set-op runner -------- //

function applySetOp(
  self: Rangeable<Markup>,
  other: Rangeable<Markup>,
  name: SetOpName,
): Rangeable<Markup> {
  switch (name) {
    case "union":
      return self.union(other);
    case "intersect":
      // Ruby names this `intersect`; JS API exposes `intersection`.
      return self.intersection(other);
    case "difference":
      return self.difference(other);
    case "symmetric_difference":
      // Ruby uses snake_case; JS uses camelCase.
      return self.symmetricDifference(other);
    default: {
      const exhaustive: never = name;
      throw new Error(`unknown set op: ${String(exhaustive)}`);
    }
  }
}

function serialiseState(r: Rangeable<Markup>): ExpectedState {
  const insertion_order: string[] = [];
  const intervals: Record<string, Array<[number, number]>> = {};
  for (const [element, ivs] of r) {
    const k = canonicalKey(element);
    insertion_order.push(k);
    intervals[k] = ivs.map((iv) => [iv.lo, iv.hi] as [number, number]);
  }
  return { insertion_order, intervals };
}

function verifySetOp(entry: SetOpEntry): void {
  const selfR = buildFromOps(entry.self_ops);
  const otherR = buildFromOps(entry.other_ops);
  let result = applySetOp(selfR, otherR, entry.op);
  if (entry.chain_ops !== undefined) {
    const chainR = buildFromOps(entry.chain_ops);
    result = applySetOp(result, chainR, entry.op);
  }

  const actualState = serialiseState(result);
  expect(
    actualState.insertion_order,
    `set_op ${entry.id}: insertion_order`,
  ).toEqual(entry.expected_state.insertion_order);
  expect(
    actualState.intervals,
    `set_op ${entry.id}: intervals`,
  ).toEqual(entry.expected_state.intervals);

  for (const probe of entry.probes ?? []) {
    checkProbe(result, probe, `set_op ${entry.id}`);
  }
}

// -------- Phase splitting (v2) -------- //

interface PhaseSnapshots {
  v1: Rangeable<Markup>;
  after_removes: Rangeable<Markup>;
  final: Rangeable<Markup>;
}

function buildPhaseSnapshots(ops: Op[]): PhaseSnapshots {
  // v1 boundary = index of the first non-insert op (matches Ruby runner).
  let v1Boundary = ops.length;
  for (let i = 0; i < ops.length; i += 1) {
    if ((ops[i]!.op ?? "insert") !== "insert") {
      v1Boundary = i;
      break;
    }
  }

  // Snapshot 1: all inserts only.
  const v1Ops = ops.slice(0, v1Boundary);
  const r_v1 = buildFromOps(v1Ops);

  // Snapshot 2: v1 ops + first 30 `remove` ops only (skip everything else
  // that follows in the tail).
  const r_after_removes = buildFromOps(v1Ops);
  let removesTaken = 0;
  for (let i = v1Boundary; i < ops.length; i += 1) {
    if (removesTaken === 30) break;
    const op = ops[i]!;
    if ((op.op ?? "insert") === "remove") {
      applyOp(r_after_removes, op);
      removesTaken += 1;
    }
  }

  // Snapshot 3: every op applied in order.
  const r_final = buildFromOps(v1Ops);
  for (let i = v1Boundary; i < ops.length; i += 1) {
    applyOp(r_final, ops[i]!);
  }

  return { v1: r_v1, after_removes: r_after_removes, final: r_final };
}

function probePhase(p: Probe): ProbePhase {
  return p.phase ?? "v1";
}

// -------- v1 runner -------- //

if (schemaVersion === 1) {
  const v1Fixture = fixture as FixtureV1;
  const replayed = buildFromOps(v1Fixture.ops);

  describe("cross-language fixture v1 — subscript probes", () => {
    for (const probe of v1Fixture.probes.filter(
      (p): p is SubscriptProbe => p.kind === "subscript",
    )) {
      it(`i=${probe.i}`, () => {
        checkSubscriptProbe(replayed, probe, "v1");
      });
    }
  });

  describe("cross-language fixture v1 — transitions probes", () => {
    for (const probe of v1Fixture.probes.filter(
      (p): p is TransitionsProbe => p.kind === "transitions",
    )) {
      it(`lo=${probe.lo} hi=${probe.hi}`, () => {
        checkTransitionsProbe(replayed, probe, "v1");
      });
    }
  });
}

// -------- v2 runner -------- //

if (schemaVersion === 2) {
  const v2Fixture = fixture as FixtureV2;
  const snapshots = buildPhaseSnapshots(v2Fixture.ops);

  // Group probes by phase so each phase gets its own readable describe block.
  const probesByPhase: Record<ProbePhase, Probe[]> = {
    v1: [],
    after_removes: [],
    final: [],
  };
  for (const p of v2Fixture.probes) {
    probesByPhase[probePhase(p)].push(p);
  }

  for (const phase of ["v1", "after_removes", "final"] as const) {
    const target = snapshots[phase];
    const phaseProbes = probesByPhase[phase];

    describe(`cross-language fixture v2 — ${phase} subscript probes`, () => {
      const subs = phaseProbes.filter(
        (p): p is SubscriptProbe => p.kind === "subscript",
      );
      if (subs.length === 0) {
        it.skip("no subscript probes in this phase", () => {});
        return;
      }
      for (const probe of subs) {
        it(`i=${probe.i}`, () => {
          checkSubscriptProbe(target, probe, `phase=${phase}`);
        });
      }
    });

    describe(`cross-language fixture v2 — ${phase} transitions probes`, () => {
      const trs = phaseProbes.filter(
        (p): p is TransitionsProbe => p.kind === "transitions",
      );
      if (trs.length === 0) {
        it.skip("no transitions probes in this phase", () => {});
        return;
      }
      for (const probe of trs) {
        it(`lo=${probe.lo} hi=${probe.hi}`, () => {
          checkTransitionsProbe(target, probe, `phase=${phase}`);
        });
      }
    });
  }

  describe("cross-language fixture v2 — set_ops", () => {
    for (const entry of v2Fixture.set_ops) {
      it(entry.id, () => {
        verifySetOp(entry);
      });
    }
  });
}
