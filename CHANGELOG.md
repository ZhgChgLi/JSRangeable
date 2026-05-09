# Changelog

All notable changes to this project will be documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-10

Initial public release of the TypeScript / JavaScript reference
implementation of the
[Rangeable RFC](https://github.com/ZhgChgLi/RangeableRFC).

### Added
- `Rangeable<E>` generic container with the full RFC §3 API:
  `insert`, `at`, `getRange`, `transitions`, `copy`, iteration via
  `Symbol.iterator`, `size`, `empty`, `version`.
- `Interval`, `Slot`, `TransitionEvent` value classes (frozen).
- `RangeableError` and `InvalidIntervalError` (Error subclasses).
- Element equality via a required `keyFn: (e: E) => string | number`
  callback supplied at construction time. Aligns with the
  cross-language fixture's string-key convention and avoids requiring
  Element types to implement an `equals` / `hashCode` interface.
- Dual ESM + CJS output via `tsup`; bundled `.d.ts` types.

### Verified
- 23 RFC §10 contract tests.
- 86 cross-language probes against the shared 160-op fixture (sha256
  `316ac8619fd632174b2374ed2137348e8d744e3904b002761d0dbdce38ea2edf`,
  byte-identical to the Ruby, Swift and Python fixtures).
- Property test against a brute-force oracle over 1000 random ops with a
  seeded Mulberry32 RNG.
