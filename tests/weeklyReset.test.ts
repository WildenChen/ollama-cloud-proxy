import { describe, expect, test } from "bun:test";
import { getNextAnchoredIntervalResetAt, getNextFixedWeeklyResetAt } from "../src/usage/weeklyReset";

function utcForTaipei(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

describe("getNextFixedWeeklyResetAt", () => {
  test("Monday 00:00 Taipei returns same Monday 08:30", () => {
    expect(
      getNextFixedWeeklyResetAt(utcForTaipei(2026, 6, 1, 0, 0), "Asia/Taipei", 1, "08:30").toISOString()
    ).toBe(utcForTaipei(2026, 6, 1, 8, 30).toISOString());
  });

  test("Monday 08:29 Taipei returns same Monday 08:30", () => {
    expect(
      getNextFixedWeeklyResetAt(utcForTaipei(2026, 6, 1, 8, 29), "Asia/Taipei", 1, "08:30").toISOString()
    ).toBe(utcForTaipei(2026, 6, 1, 8, 30).toISOString());
  });

  test("Monday 08:30 Taipei returns next Monday 08:30", () => {
    expect(
      getNextFixedWeeklyResetAt(utcForTaipei(2026, 6, 1, 8, 30), "Asia/Taipei", 1, "08:30").toISOString()
    ).toBe(utcForTaipei(2026, 6, 8, 8, 30).toISOString());
  });

  test("Monday 08:31 Taipei returns next Monday 08:30", () => {
    expect(
      getNextFixedWeeklyResetAt(utcForTaipei(2026, 6, 1, 8, 31), "Asia/Taipei", 1, "08:30").toISOString()
    ).toBe(utcForTaipei(2026, 6, 8, 8, 30).toISOString());
  });

  test("Tuesday returns next Monday 08:30", () => {
    expect(
      getNextFixedWeeklyResetAt(utcForTaipei(2026, 6, 2, 12, 0), "Asia/Taipei", 1, "08:30").toISOString()
    ).toBe(utcForTaipei(2026, 6, 8, 8, 30).toISOString());
  });

  test("Sunday 23:59 Taipei returns next day Monday 08:30", () => {
    expect(
      getNextFixedWeeklyResetAt(utcForTaipei(2026, 6, 7, 23, 59), "Asia/Taipei", 1, "08:30").toISOString()
    ).toBe(utcForTaipei(2026, 6, 8, 8, 30).toISOString());
  });
});

describe("getNextAnchoredIntervalResetAt", () => {
  const anchor = "2026-06-06T20:00:00.000Z";

  test("before the anchor returns the anchor", () => {
    expect(getNextAnchoredIntervalResetAt(utcForTaipei(2026, 6, 7, 2, 0), anchor, 5).toISOString()).toBe(anchor);
  });

  test("at the anchor returns the next 5-hour boundary", () => {
    expect(getNextAnchoredIntervalResetAt(utcForTaipei(2026, 6, 7, 4, 0), anchor, 5).toISOString()).toBe(
      "2026-06-07T01:00:00.000Z"
    );
  });

  test("inside a window returns the upcoming 5-hour boundary", () => {
    expect(getNextAnchoredIntervalResetAt(utcForTaipei(2026, 6, 7, 6, 30), anchor, 5).toISOString()).toBe(
      "2026-06-07T01:00:00.000Z"
    );
  });
});
