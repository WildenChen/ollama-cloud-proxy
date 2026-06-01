import { describe, expect, test } from "bun:test";
import { getNextFixedWeeklyResetAt } from "../src/usage/weeklyReset";

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
