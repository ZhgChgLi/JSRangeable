# JSRangeable

[![npm](https://img.shields.io/npm/v/rangeable-js.svg)](https://www.npmjs.com/package/rangeable-js)
[![Node](https://img.shields.io/node/v/rangeable-js.svg)](https://www.npmjs.com/package/rangeable-js)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Reference TypeScript / JavaScript implementation of [`Rangeable<Element>`](https://github.com/ZhgChgLi/RangeableRFC) — a generic, integer-coordinate, closed-interval set container with first-insert ordered active queries.

## Installation

```bash
npm install rangeable-js
```

## Usage

```ts
import { Rangeable } from "rangeable-js";

interface Markup {
  kind: "strong" | "italic" | "code" | "link";
  href?: string;
}

const r = new Rangeable<Markup>({
  keyFn: (m) => (m.kind === "link" ? `link:${m.href}` : m.kind),
});

r.insert({ kind: "strong" }, { start: 2, end: 5 });
r.insert({ kind: "strong" }, { start: 3, end: 7 });   // merges with [2, 5] → [2, 7]
r.insert({ kind: "strong" }, { start: 9, end: 11 });  // disjoint
r.insert({ kind: "italic" }, { start: 3, end: 8 });

r.getRange({ kind: "strong" });   // [Interval(2, 7), Interval(9, 11)]
r.getRange({ kind: "italic" });   // [Interval(3, 8)]

r.at(4).objs;    // [{kind:"strong"}, {kind:"italic"}]   first-insert order
r.at(8).objs;    // [{kind:"italic"}]
r.at(10).objs;   // [{kind:"strong"}]
```

### Sweep iteration via transitions

```ts
for (const event of r.transitions({ from: 0, to: 15 })) {
  console.log(event.coordinate, event.kind, event.element);
}
```

## API

| Member | Returns | Notes |
|---|---|---|
| `new Rangeable<E>({ keyFn })` | constructor | `keyFn` is required, returns `string \| number` |
| `r.insert(e, { start, end })` | `this` (chainable) | throws `InvalidIntervalError` on `start > end` |
| `r.at(i)` | `Slot<E>` | `Slot.objs` is the active-set tuple |
| `r.getRange(e)` | `Interval[]` | merged disjoint ranges |
| `r.transitions({ from, to })` | `TransitionEvent<E>[]` | `to: null` means +∞ |
| `r.size` | `number` | distinct elements |
| `r.empty` | `boolean` | |
| `[...r]` | `[E, Interval[]][]` | first-insert order |
| `r.copy()` | `Rangeable<E>` | deep copy |
| `r.version` | `number` | unchanged on idempotent insert |

## Element equality

Unlike Ruby (`==` / `eql?` / `hash`), Swift (`Hashable`) or Python
(`__eq__` / `__hash__`), JavaScript has no built-in equality protocol
for arbitrary values. `Rangeable` requires a `keyFn` callback that
maps each element to a stable `string` or `number` "equivalence-class
key". Two elements with the same key are treated as the same logical
element.

```ts
// Without href: collapse all 'strong' tokens into one class.
const keyFn = (m: Markup) =>
  m.kind === "link" ? `link:${m.href}` : m.kind;

// Or, if every Markup has a unique payload, use the full JSON:
const keyFn = JSON.stringify;
```

`keyFn` MUST be deterministic and stable across the lifetime of the
`Rangeable` instance.

## Semantics

- **End is inclusive**: `{ start: a, end: b }` covers `[a, b]`, both ends.
- **Same-element merging**: equal elements (by `keyFn`) merge on overlap or integer adjacency. `[2, 4] ∪ [5, 7] = [2, 7]`.
- **Idempotent insert**: re-inserting a contained interval does not bump `version`.
- **Out-of-order rejected**: `insert(e, { start: 5, end: 2 })` throws `InvalidIntervalError`.
- **Active-set ordering**: deterministic — first-insert order of the element.
- **Coordinate sentinel**: a close event for an interval ending at the optional `intMaxSentinel` carries `coordinate === null` (null == +∞ per RFC §4.7).

See [RangeableRFC](https://github.com/ZhgChgLi/RangeableRFC) § 4 for normative semantics and § 10 for the 23-case test contract.

## Cross-language consistency

This TypeScript implementation joins the [Ruby](https://github.com/ZhgChgLi/RubyRangeable), [Swift](https://github.com/ZhgChgLi/SwiftRangeable), [Python](https://github.com/ZhgChgLi/PythonRangeable), [Kotlin](https://github.com/ZhgChgLi/KotlinRangeable) and [Go](https://github.com/ZhgChgLi/GoRangeable) implementations. All six share a 160-op / 86-probe JSON fixture and produce byte-identical outputs.

## See also

- **[RangeableRFC](https://github.com/ZhgChgLi/RangeableRFC)** — normative specification.
- **[RubyRangeable](https://github.com/ZhgChgLi/RubyRangeable)** — Ruby reference (`gem install rangeable`).
- **[SwiftRangeable](https://github.com/ZhgChgLi/SwiftRangeable)** — Swift reference (SPM).
- **[PythonRangeable](https://github.com/ZhgChgLi/PythonRangeable)** — Python reference (`pip install rangeable`).
- **[KotlinRangeable](https://github.com/ZhgChgLi/KotlinRangeable)** — Kotlin/JVM reference (JitPack).
- **[GoRangeable](https://github.com/ZhgChgLi/GoRangeable)** — Go reference (`go get github.com/ZhgChgLi/GoRangeable`).

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT (c) ZhgChgLi
