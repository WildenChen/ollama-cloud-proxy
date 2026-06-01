import type { DatabaseStore, EventInput } from "../storage/database";

function sanitizeDetails(details: Record<string, unknown> | null | undefined) {
  if (!details) return null;
  const blocked = new Set(["apiKey", "authorization", "prompt", "messages", "response"]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (blocked.has(key)) continue;
    if (typeof value === "string" && value.length > 500) {
      result[key] = `${value.slice(0, 500)}...`;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class EventStore {
  constructor(private readonly store: DatabaseStore) {}

  emit(input: EventInput) {
    this.store.addEvent({ ...input, details: sanitizeDetails(input.details) });
  }

  list(filters: Parameters<DatabaseStore["listEvents"]>[0]) {
    return this.store.listEvents(filters).map((row) => ({
      ...row,
      details: row.detailsJson ? JSON.parse(String(row.detailsJson)) : null,
      detailsJson: undefined,
    }));
  }

  cleanup(retentionDays: number, maxEvents: number) {
    this.store.cleanupEvents(retentionDays, maxEvents);
  }
}
