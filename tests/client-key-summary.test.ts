import { describe, expect, test } from "bun:test";
import { buildClientKeySummary } from "../src/admin/clientKeySummary";
import type { ClientApiKeyRecord } from "../src/types/domain";

function dbKey(overrides: Partial<ClientApiKeyRecord> = {}): ClientApiKeyRecord {
  return {
    id: "db-1",
    name: "openclaw",
    tokenPreview: "ocp_abcd...wxyz",
    encryptedToken: "db-token",
    enabled: true,
    notes: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("proxy client key summary", () => {
  test("keeps environment-only deployments protected without exposing tokens", () => {
    const summary = buildClientKeySummary({
      databaseKeys: [],
      environmentKeys: new Map([["env-secret", "legacy-openclaw"]]),
      decryptDatabaseToken: () => "",
    });

    expect(summary.protectionEnabled).toBe(true);
    expect(summary.anonymousMode).toBe(false);
    expect(summary.effectiveTotal).toBe(1);
    expect(summary.environmentManagedTotal).toBe(1);
    expect(summary.items[0]).toMatchObject({
      name: "legacy-openclaw",
      source: "environment",
      editable: false,
      tokenPreview: null,
    });
    expect(JSON.stringify(summary)).not.toContain("env-secret");
  });

  test("preserves anonymous mode when no client key source exists", () => {
    const summary = buildClientKeySummary({
      databaseKeys: [],
      environmentKeys: new Map(),
      decryptDatabaseToken: () => "",
    });

    expect(summary.protectionEnabled).toBe(false);
    expect(summary.anonymousMode).toBe(true);
    expect(summary.effectiveTotal).toBe(0);
  });

  test("counts database and environment sources while deduplicating the same token", () => {
    const summary = buildClientKeySummary({
      databaseKeys: [dbKey()],
      environmentKeys: new Map([["same-secret", "legacy-openclaw"]]),
      decryptDatabaseToken: () => "same-secret",
    });

    expect(summary.databaseManagedTotal).toBe(1);
    expect(summary.environmentManagedTotal).toBe(1);
    expect(summary.effectiveTotal).toBe(1);
    expect(summary.duplicateSourceCount).toBe(2);
    expect(summary.items.every((item) => item.duplicateSource)).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("same-secret");
  });

  test("marks name-based activity as unreliable when sources share a name", () => {
    const summary = buildClientKeySummary({
      databaseKeys: [dbKey()],
      environmentKeys: new Map([["different-secret", "openclaw"]]),
      clientActivity: [{ clientName: "openclaw", lastRequestAt: "2026-07-29T00:00:00.000Z" }],
      decryptDatabaseToken: () => "db-secret",
    });

    expect(summary.effectiveTotal).toBe(2);
    expect(summary.items.every((item) => item.duplicateName)).toBe(true);
    expect(summary.items.every((item) => item.lastRequestAtReliable === false)).toBe(true);
  });

  test("keeps protection enabled when a configured database key cannot be decrypted", () => {
    const summary = buildClientKeySummary({
      databaseKeys: [dbKey({ enabled: false }), dbKey({ id: "broken", name: "broken", encryptedToken: "bad" })],
      environmentKeys: new Map(),
      decryptDatabaseToken: (key) => {
        if (key.id === "broken") throw new Error("decrypt failed");
        return "unused";
      },
    });

    expect(summary.databaseManagedTotal).toBe(2);
    expect(summary.enabledDatabaseTotal).toBe(1);
    expect(summary.effectiveTotal).toBe(0);
    expect(summary.protectionEnabled).toBe(true);
    expect(summary.anonymousMode).toBe(false);
  });
});
