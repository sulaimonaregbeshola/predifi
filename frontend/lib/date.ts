/**
 * Shared date helpers for lightweight, deterministic formatting.
 *
 * Keeping this local avoids pulling in a heavier date library for the small
 * amount of date rendering the frontend currently needs.
 *
 * ## Clock authority
 *
 * Time-sensitive displays in the frontend are *presentational only*. The
 * authoritative source for each deadline is:
 *
 * - **Pool close time**: the chain / smart contract is authoritative. The
 *   frontend renders whatever close time the contract reports; it must never
 *   treat its own clock as the source of truth for whether a pool is closed.
 * - **Quote freshness / expiry**: the backend is authoritative. The frontend
 *   may display a countdown, but whether a quote is still valid is decided by
 *   the backend (and ultimately enforced server-side).
 *
 * Because of this, all helpers that depend on "now" accept an injectable clock
 * so tests can drive deterministic skew scenarios (clock ahead, clock behind,
 * and suspended-tab resume) without relying on wall-clock time.
 */

/**
 * A clock returns the current time as a Unix timestamp in milliseconds.
 *
 * Injecting a clock (instead of calling `Date.now()` directly) lets tests
 * simulate clock skew in both directions and suspended-tab resume.
 */
export type Clock = () => number;

/** Default clock backed by the host wall clock. */
export const systemClock: Clock = () => Date.now();

/**
 * Format a date-like value as `DD-MM-YYYY HH:mm` in UTC.
 *
 * The helper accepts a `Date`, Unix timestamp (milliseconds), or any string
 * the `Date` constructor can parse.
 */
export function formatUtcDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${day}-${month}-${year} ${hours}:${minutes}`;
}

/**
 * Parse a date-like value into a Unix timestamp (milliseconds), or `null` if
 * the value cannot be parsed.
 */
export function toTimestamp(value: string | number | Date): number | null {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Compute the remaining milliseconds until `deadline` relative to `now`.
 *
 * Returns `null` when the deadline cannot be parsed. The result is clamped at
 * zero so a clock that is ahead of the deadline never yields a negative
 * countdown. Note that this is a *display* helper only: the chain/contract is
 * authoritative for pool close time and the backend for quote freshness.
 */
export function remainingMs(
  deadline: string | number | Date,
  now: number = systemClock(),
): number | null {
  const target = toTimestamp(deadline);
  if (target === null) {
    return null;
  }
  return Math.max(0, target - now);
}

/**
 * Format a countdown as `HH:mm:ss` (or `Dd HH:mm:ss` when at least one day
 * remains) for display next to a deadline.
 *
 * Returns an empty string when the deadline cannot be parsed. Uses the
 * injectable clock so suspended-tab resume and skew can be tested
 * deterministically.
 */
export function formatCountdown(
  deadline: string | number | Date,
  now: number = systemClock(),
): string {
  const remaining = remainingMs(deadline, now);
  if (remaining === null) {
    return "";
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return days > 0 ? `${days}d ${clock}` : clock;
}

/**
 * Determine whether a deadline has passed relative to `now`.
 *
 * Returns `null` when the deadline cannot be parsed. This is a display helper
 * only; authoritative close/expiry decisions are made by the chain/contract
 * (pool close time) and the backend (quote freshness).
 */
export function isPast(
  deadline: string | number | Date,
  now: number = systemClock(),
): boolean | null {
  const target = toTimestamp(deadline);
  if (target === null) {
    return null;
  }
  return now >= target;
}

/**
 * A countdown timer that reads time from an injectable clock.
 *
 * The timer does not own a `setInterval`; callers drive it by calling
 * `tick()` (e.g. from a `setInterval` or on `visibilitychange` when a
 * suspended tab resumes). This keeps the timer fully deterministic in tests.
 */
export interface CountdownTimer {
  /** Current remaining milliseconds, clamped at zero. */
  remaining(): number | null;
  /** Current formatted countdown string. */
  formatted(): string;
  /** Whether the deadline has passed according to the injected clock. */
  expired(): boolean | null;
  /** Recompute against the current clock value. */
  tick(): void;
}

/**
 * Create a countdown timer for `deadline` using the given clock.
 *
 * The clock is read on each `tick()` so a suspended tab that resumes after a
 * long gap will immediately reflect the correct remaining time (or expiry).
 */
export function createCountdownTimer(
  deadline: string | number | Date,
  clock: Clock = systemClock,
): CountdownTimer {
  let now = clock();

  const recompute = () => {
    now = clock();
  };

  return {
    remaining: () => remainingMs(deadline, now),
    formatted: () => formatCountdown(deadline, now),
    expired: () => isPast(deadline, now),
    tick: recompute,
  };
}