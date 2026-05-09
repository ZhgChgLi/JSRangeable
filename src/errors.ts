/**
 * Base class for Rangeable errors.
 */
export class RangeableError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "RangeableError";
    Object.setPrototypeOf(this, RangeableError.prototype);
  }
}

/**
 * Raised when an interval is malformed (start > end), or a transitions
 * query range is malformed (lo > hi). RFC §3.7 / §3.2 / §3.5.
 */
export class InvalidIntervalError extends RangeableError {
  constructor(message?: string) {
    super(message);
    this.name = "InvalidIntervalError";
    Object.setPrototypeOf(this, InvalidIntervalError.prototype);
  }
}
