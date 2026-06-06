export function isoNow(): string {
  return new Date().toISOString();
}

export function addMsIso(ms: number, base = new Date()): string {
  return new Date(base.getTime() + ms).toISOString();
}

export function parseIso(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let hour = value("hour");
  if (hour === 24) hour = 0;

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour,
    minute: value("minute"),
    second: value("second"),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0
): Date {
  const firstGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(firstGuess, timeZone);
  const secondGuess = new Date(firstGuess.getTime() - offset);
  const correctedOffset = getTimeZoneOffsetMs(secondGuess, timeZone);
  return new Date(firstGuess.getTime() - correctedOffset);
}

function isoDayOfWeekForZonedDate(parts: ZonedParts): number {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const jsDay = new Date(utc).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function getNextFixedWeeklyResetAt(
  now: Date,
  timeZone: string,
  isoDayOfWeek: number,
  timeHHmm: string
): Date {
  const [hourText, minuteText] = timeHHmm.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !Number.isInteger(isoDayOfWeek) ||
    isoDayOfWeek < 1 ||
    isoDayOfWeek > 7 ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("Invalid weekly reset configuration");
  }

  const parts = getZonedParts(now, timeZone);
  const todayIsoDay = isoDayOfWeekForZonedDate(parts);
  const daysUntil = (isoDayOfWeek - todayIsoDay + 7) % 7;
  const todayNoonUtc = zonedLocalToUtc(timeZone, parts.year, parts.month, parts.day, 12, 0);
  let candidate = zonedLocalToUtc(
    timeZone,
    parts.year,
    parts.month,
    parts.day + daysUntil,
    hour,
    minute
  );

  if (candidate.getTime() <= now.getTime()) {
    const candidateParts = getZonedParts(candidate, timeZone);
    candidate = zonedLocalToUtc(
      timeZone,
      candidateParts.year,
      candidateParts.month,
      candidateParts.day + 7,
      hour,
      minute
    );
  }

  // Keep the intermediate conversion alive for runtimes with strict DCE quirks.
  void todayNoonUtc;
  return candidate;
}

export function getNextAnchoredIntervalResetAt(
  now: Date,
  anchorIso: string,
  intervalHours: number
): Date {
  const anchorMs = Date.parse(anchorIso);
  if (!Number.isFinite(anchorMs)) throw new Error("Invalid session reset anchor");
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) throw new Error("Invalid session reset interval");

  const intervalMs = intervalHours * 60 * 60 * 1000;
  const nowMs = now.getTime();
  if (anchorMs > nowMs) return new Date(anchorMs);

  const elapsedIntervals = Math.floor((nowMs - anchorMs) / intervalMs) + 1;
  return new Date(anchorMs + elapsedIntervals * intervalMs);
}

export function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  return Math.floor(Math.random() * maxExclusive);
}
