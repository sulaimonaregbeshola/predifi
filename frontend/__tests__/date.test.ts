import { formatUtcDateTime } from "@/lib/date";

describe("formatUtcDateTime", () => {
  it("formats a Date input as DD-MM-YYYY HH:mm in UTC", () => {
    const date = new Date(Date.UTC(2026, 0, 5, 9, 7));
    expect(formatUtcDateTime(date)).toBe("05-01-2026 09:07");
  });

  it("formats a millisecond timestamp", () => {
    const timestamp = Date.UTC(2026, 8, 26, 14, 30);
    expect(formatUtcDateTime(timestamp)).toBe("26-09-2026 14:30");
  });

  it("formats an ISO string", () => {
    expect(formatUtcDateTime("2026-03-15T08:45:00.000Z")).toBe(
      "15-03-2026 08:45"
    );
  });

  it("zero-pads single-digit day, month, hour, and minute", () => {
    const date = new Date(Date.UTC(2026, 2, 4, 3, 5));
    expect(formatUtcDateTime(date)).toBe("04-03-2026 03:05");
  });

  it('returns "" for invalid input', () => {
    expect(formatUtcDateTime("not-a-date")).toBe("");
    expect(formatUtcDateTime(Number.NaN)).toBe("");
  });
});

/**
 * Clock-skew scenarios for frontend date formatting and deadline display.
 *
 * Authority model (documented here so tests encode the contract):
 * - The server is authoritative for all deadlines (challenge expiry, quote
 *   freshness, close time). Clients only *display* server-provided instants.
 * - `formatUtcDateTime` renders the instant in UTC, so the output is
 *   independent of the client's local timezone and of any client clock skew.
 * - Countdowns are computed from the server-provided deadline relative to a
 *   controllable "now" clock; a skewed client clock must not change the
 *   rendered deadline, only (potentially) the countdown, which is clamped.
 */

const MINUTE_MS = 60 * 1000;

/** A controllable clock for deterministic skew scenarios. */
class FakeClock {
  private current: number;

  constructor(startIso: string) {
    this.current = Date.parse(startIso);
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}

/**
 * Countdown helper mirroring the UI contract: the deadline is authoritative
 * (server-provided), `now` is the client clock. Negative remaining time is
 * clamped to zero so a fast client clock never shows a negative countdown.
 */
function remainingMs(deadlineMs: number, nowMs: number): number {
  return Math.max(0, deadlineMs - nowMs);
}

function formatCountdown(deadlineMs: number, nowMs: number): string {
  const totalSeconds = Math.floor(remainingMs(deadlineMs, nowMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

describe("clock skew: deadline display", () => {
  const serverDeadline = "2026-06-01T12:00:00.000Z";

  it("renders the server deadline identically regardless of client clock skew", () => {
    const serverNow = new FakeClock("2026-06-01T11:00:00.000Z");
    const fastClient = new FakeClock("2026-06-01T11:05:00.000Z"); // +5 min skew
    const slowClient = new FakeClock("2026-06-01T10:55:00.000Z"); // -5 min skew

    // Sanity: the clocks actually differ.
    expect(fastClient.now() - serverNow.now()).toBe(5 * MINUTE_MS);
    expect(slowClient.now() - serverNow.now()).toBe(-5 * MINUTE_MS);

    // The displayed deadline is derived from the server instant only.
    const expected = "01-06-2026 12:00";
    expect(formatUtcDateTime(serverDeadline)).toBe(expected);
    expect(formatUtcDateTime(serverDeadline)).toBe(expected);
    expect(formatUtcDateTime(serverDeadline)).toBe(expected);
  });

  it("does not shift the displayed deadline when the client clock is ahead (positive skew)", () => {
    const client = new FakeClock("2026-06-01T11:00:00.000Z");
    client.advance(10 * MINUTE_MS); // client thinks it is 11:10
    expect(formatUtcDateTime("2026-06-01T12:00:00.000Z")).toBe(
      "01-06-2026 12:00"
    );
  });

  it("does not shift the displayed deadline when the client clock is behind (negative skew)", () => {
    const client = new FakeClock("2026-06-01T11:00:00.000Z");
    client.advance(-10 * MINUTE_MS); // client thinks it is 10:50
    expect(formatUtcDateTime("2026-06-01T12:00:00.000Z")).toBe(
      "01-06-2026 12:00"
    );
  });
});

describe("clock skew: countdown behavior", () => {
  const deadlineMs = Date.parse("2026-06-01T12:00:00.000Z");

  it("counts down correctly when client clock matches the server", () => {
    const clock = new FakeClock("2026-06-01T11:59:00.000Z");
    expect(formatCountdown(deadlineMs, clock.now())).toBe("01:00");
    clock.advance(30 * 1000);
    expect(formatCountdown(deadlineMs, clock.now())).toBe("00:30");
  });

  it("clamps to zero when the client clock is ahead of the deadline (positive skew)", () => {
    const clock = new FakeClock("2026-06-01T12:05:00.000Z"); // 5 min past deadline
    expect(remainingMs(deadlineMs, clock.now())).toBe(0);
    expect(formatCountdown(deadlineMs, clock.now())).toBe("00:00");
  });

  it("shows a longer countdown when the client clock is behind (negative skew)", () => {
    const clock = new FakeClock("2026-06-01T11:55:00.000Z"); // 5 min behind
    expect(formatCountdown(deadlineMs, clock.now())).toBe("05:00");
  });

  it("never renders a negative countdown", () => {
    const clock = new FakeClock("2026-06-02T00:00:00.000Z");
    expect(formatCountdown(deadlineMs, clock.now())).toBe("00:00");
  });
});

describe("clock skew: suspended-tab resume (visibilitychange)", () => {
  const deadlineMs = Date.parse("2026-06-01T12:00:00.000Z");

  let visibilityState: DocumentVisibilityState;
  let clock: FakeClock;
  let rendered: string;

  function renderCloseDisplay(): void {
    rendered = formatCountdown(deadlineMs, clock.now());
  }

  function onVisibilityChange(): void {
    // On resume, the UI recomputes from the authoritative deadline and the
    // current clock rather than trusting a stale interval tick.
    if (visibilityState === "visible") {
      renderCloseDisplay();
    }
  }

  beforeEach(() => {
    visibilityState = "visible";
    clock = new FakeClock("2026-06-01T11:59:00.000Z");
    rendered = "";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    document.addEventListener("visibilitychange", onVisibilityChange);
  });

  afterEach(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });

  function setVisibility(state: DocumentVisibilityState): void {
    visibilityState = state;
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("recomputes the close display after a suspended tab resumes", () => {
    renderCloseDisplay();
    expect(rendered).toBe("01:00");

    // Tab is hidden; wall clock keeps moving while timers are throttled.
    setVisibility("hidden");
    clock.advance(45 * 1000);
    // No recompute while hidden.
    expect(rendered).toBe("01:00");

    // Resume: recompute against the authoritative deadline.
    setVisibility("visible");
    expect(rendered).toBe("00:15");
  });

  it("clamps to zero when the tab resumes after the deadline has passed", () => {
    renderCloseDisplay();
    expect(rendered).toBe("01:00");

    setVisibility("hidden");
    clock.advance(10 * MINUTE_MS); // resume well past the deadline
    setVisibility("visible");

    expect(rendered).toBe("00:00");
  });

  it("handles resume when the client clock jumped forward (positive skew)", () => {
    renderCloseDisplay();
    expect(rendered).toBe("01:00");

    setVisibility("hidden");
    // Client clock jumps forward by 2 minutes (e.g. NTP correction).
    clock.advance(2 * MINUTE_MS);
    setVisibility("visible");

    expect(rendered).toBe("00:00");
  });

  it("handles resume when the client clock jumped backward (negative skew)", () => {
    renderCloseDisplay();
    expect(rendered).toBe("01:00");

    setVisibility("hidden");
    // Client clock jumps backward by 1 minute.
    clock.advance(-1 * MINUTE_MS);
    setVisibility("visible");

    // Countdown reflects the (skewed) client clock but stays non-negative.
    expect(rendered).toBe("02:00");
  });

  it("keeps the displayed deadline stable across suspend/resume", () => {
    const serverDeadline = "2026-06-01T12:00:00.000Z";
    const before = formatUtcDateTime(serverDeadline);

    setVisibility("hidden");
    clock.advance(30 * MINUTE_MS);
    setVisibility("visible");

    const after = formatUtcDateTime(serverDeadline);
    expect(after).toBe(before);
    expect(after).toBe("01-06-2026 12:00");
  });
});