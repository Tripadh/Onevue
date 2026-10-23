import { DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS } from "./constants";

export interface AnalyticsRange {
  from: string;
  to: string;
  timezone: string;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  compare: boolean;
  granularity: "hour" | "day";
}

export class AnalyticsQueryError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = "invalid_query", status = 400) {
    super(message);
    this.name = "AnalyticsQueryError";
    this.status = status;
    this.code = code;
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertTimeZone(timeZone: string): string {
  const value = timeZone.trim();
  if (!value || value.length > 80) throw new AnalyticsQueryError("Invalid timezone.");
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw new AnalyticsQueryError("Invalid timezone.");
  }
  return value;
}

export function calendarToday(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  if (!DATE_PATTERN.test(isoDate)) throw new AnalyticsQueryError("Invalid date.");
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const hour = read("hour") === 24 ? 0 : read("hour");
  const zonedAsUtc = Date.UTC(read("year"), read("month") - 1, read("day"), hour, read("minute"), read("second"));
  return zonedAsUtc - instant.getTime();
}

export function zonedStartToUtc(isoDate: string, timeZone: string): Date {
  if (!DATE_PATTERN.test(isoDate)) throw new AnalyticsQueryError("Invalid date.");
  const [year, month, day] = isoDate.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const first = new Date(guess.getTime() - timeZoneOffsetMs(guess, timeZone));
  return new Date(guess.getTime() - timeZoneOffsetMs(first, timeZone));
}

export function inclusiveCalendarDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86400000) + 1;
}

export function parseAnalyticsRange(searchParams: URLSearchParams, now = new Date()): AnalyticsRange {
  const timezone = assertTimeZone(searchParams.get("timezone") || "UTC");
  const today = calendarToday(timezone, now);
  const from = searchParams.get("from") || addCalendarDays(today, -(DEFAULT_RANGE_DAYS - 1));
  const to = searchParams.get("to") || today;
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw new AnalyticsQueryError("Dates must use YYYY-MM-DD.");
  }
  if (from > to) throw new AnalyticsQueryError("The start date must be on or before the end date.");
  const days = inclusiveCalendarDays(from, to);
  if (days > MAX_RANGE_DAYS) {
    throw new AnalyticsQueryError(`Date range cannot exceed ${MAX_RANGE_DAYS} days.`);
  }

  const start = zonedStartToUtc(from, timezone);
  const end = zonedStartToUtc(addCalendarDays(to, 1), timezone);
  const compare = searchParams.get("compare") !== "false";
  const granularity = end.getTime() - start.getTime() <= 2 * 86400000 ? "hour" : "day";

  return {
    from,
    to,
    timezone,
    start,
    end,
    previousStart: new Date(start.getTime() - (end.getTime() - start.getTime())),
    previousEnd: start,
    compare,
    granularity,
  };
}

export function formatBucket(instant: Date, granularity: "hour" | "day", timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  const hour = read("hour") === "24" ? "00" : read("hour");
  const day = `${read("year")}-${read("month")}-${read("day")}`;
  return granularity === "hour" ? `${day}T${hour}:00:00` : day;
}

export function buildBucketKeys(range: AnalyticsRange): string[] {
  if (range.granularity === "day") {
    const keys: string[] = [];
    for (let day = range.from; day <= range.to; day = addCalendarDays(day, 1)) keys.push(day);
    return keys;
  }
  const keys: string[] = [];
  for (let time = range.start.getTime(); time < range.end.getTime(); time += 3600000) {
    keys.push(formatBucket(new Date(time), "hour", range.timezone));
  }
  return keys;
}

export function mongoBucketExpression(granularity: "hour" | "day", timezone: string) {
  return {
    $dateToString: {
      format: granularity === "hour" ? "%Y-%m-%dT%H:00:00" : "%Y-%m-%d",
      date: "$occurredAt",
      timezone,
    },
  };
}
