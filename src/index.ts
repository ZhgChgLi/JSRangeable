/**
 * Rangeable — hashable-element interval set with first-insert ordered active queries.
 *
 * Reference TypeScript implementation of the language-neutral Rangeable spec.
 * See https://github.com/ZhgChgLi/RangeableRFC for the normative document.
 */

export { Rangeable, type RangeableOptions } from "./rangeable.js";
export { Interval } from "./interval.js";
export { Slot } from "./slot.js";
export { TransitionEvent, type TransitionKind } from "./transition.js";
export { RangeableError, InvalidIntervalError } from "./errors.js";
