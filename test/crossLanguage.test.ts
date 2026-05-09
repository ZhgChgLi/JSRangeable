/**
 * Cross-language fixture replay.
 *
 * Consumes the shared `cross_language.json` produced by Ruby
 * (`RubyRangeable/test/cross_language_fixture.rb`) and replayed identically
 * by Swift's `CrossLanguageFixtureTests` and Python's
 * `test_cross_language.py`. Verifies all 86 probes (subscript +
 * transitions) against the Ruby-produced expected values.
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

interface Op { element: number; start: number; end: number; }
interface ExpectedEvent { coordinate: number | null; kind: string; element: string; }
interface SubscriptProbe { kind: "subscript"; i: number; expected: string[]; }
interface TransitionsProbe { kind: "transitions"; lo: number; hi: number; expected: ExpectedEvent[]; }
type Probe = SubscriptProbe | TransitionsProbe;
interface Fixture { seed: number; ops: Op[]; probes: Probe[]; }

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

function buildReplay(): Rangeable<Markup> {
  const r = new Rangeable<Markup>({ keyFn });
  for (const op of fixture.ops) {
    const e = ELEMENT_FACTORY[op.element]!();
    try {
      r.insert(e, { start: op.start, end: op.end });
    } catch {
      // Fixture is generated with start <= end; this guards future
      // mis-edits to the fixture.
    }
  }
  return r;
}

const replayed = buildReplay();

describe("cross-language fixture — subscript probes", () => {
  for (const probe of fixture.probes.filter(
    (p): p is SubscriptProbe => p.kind === "subscript",
  )) {
    it(`i=${probe.i}`, () => {
      const actual = replayed.at(probe.i).objs.map((e) => canonicalKey(e));
      expect(actual).toEqual(probe.expected);
    });
  }
});

describe("cross-language fixture — transitions probes", () => {
  for (const probe of fixture.probes.filter(
    (p): p is TransitionsProbe => p.kind === "transitions",
  )) {
    it(`lo=${probe.lo} hi=${probe.hi}`, () => {
      const events = replayed.transitions({ from: probe.lo, to: probe.hi });
      const actual = events.map((e) => ({
        coordinate: e.coordinate,
        kind: e.kind,
        element: canonicalKey(e.element),
      }));
      expect(actual).toEqual(probe.expected);
    });
  }
});
