import type { AppConfig } from "../config/env";
import type { ClientApiKeyRecord } from "../types/domain";

export type ClientActivityRow = {
  clientName: string;
  lastRequestAt?: string | null;
};

export type ProxyClientKeySummaryItem = {
  id: string;
  name: string;
  source: "database" | "environment";
  enabled: boolean;
  editable: boolean;
  tokenPreview: string | null;
  notes: string | null;
  lastRequestAt: string | null;
  lastRequestAtReliable: boolean;
  duplicateName: boolean;
  duplicateSource: boolean;
};

export type ProxyClientKeySummary = {
  protectionEnabled: boolean;
  anonymousMode: boolean;
  effectiveTotal: number;
  databaseManagedTotal: number;
  enabledDatabaseTotal: number;
  environmentManagedTotal: number;
  duplicateSourceCount: number;
  items: ProxyClientKeySummaryItem[];
};

type BuildSummaryInput = {
  databaseKeys: ClientApiKeyRecord[];
  environmentKeys: AppConfig["clientApiKeys"];
  clientActivity?: ClientActivityRow[];
  decryptDatabaseToken: (key: ClientApiKeyRecord) => string;
};

function latestActivity(rows: ClientActivityRow[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const row of rows) {
    const current = result.get(row.clientName);
    const next = row.lastRequestAt || null;
    if (!current || (next && Date.parse(next) > Date.parse(current))) result.set(row.clientName, next);
  }
  return result;
}

export function buildClientKeySummary(input: BuildSummaryInput): ProxyClientKeySummary {
  const databaseKeys = input.databaseKeys.filter((key) => !key.deletedAt);
  const enabledDatabaseKeys = databaseKeys.filter((key) => key.enabled);
  const environmentEntries = Array.from(input.environmentKeys.entries()).map(([token, name], index) => ({
    id: `env:${index + 1}`,
    token,
    name,
  }));

  const allNames = [
    ...databaseKeys.map((key) => key.name),
    ...environmentEntries.map((entry) => entry.name),
  ];
  const nameCounts = new Map<string, number>();
  for (const name of allNames) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);

  const activity = latestActivity(input.clientActivity || []);
  const environmentTokenSet = new Set(environmentEntries.map((entry) => entry.token));
  const databaseTokens = new Map<string, string>();
  for (const key of enabledDatabaseKeys) {
    try {
      databaseTokens.set(key.id, input.decryptDatabaseToken(key));
    } catch {
      // A damaged encrypted token remains visible as a database record, but is not counted as usable.
    }
  }

  const duplicateDatabaseIds = new Set(
    Array.from(databaseTokens.entries())
      .filter(([, token]) => environmentTokenSet.has(token))
      .map(([id]) => id),
  );
  const duplicateEnvironmentTokens = new Set(
    environmentEntries
      .filter((entry) => Array.from(databaseTokens.values()).includes(entry.token))
      .map((entry) => entry.token),
  );

  const effectiveTokens = new Set<string>();
  for (const token of databaseTokens.values()) effectiveTokens.add(token);
  for (const entry of environmentEntries) effectiveTokens.add(entry.token);

  const databaseItems: ProxyClientKeySummaryItem[] = databaseKeys.map((key) => {
    const duplicateName = (nameCounts.get(key.name) || 0) > 1;
    return {
      id: key.id,
      name: key.name,
      source: "database",
      enabled: key.enabled,
      editable: true,
      tokenPreview: key.tokenPreview,
      notes: key.notes,
      lastRequestAt: activity.get(key.name) || null,
      lastRequestAtReliable: !duplicateName,
      duplicateName,
      duplicateSource: duplicateDatabaseIds.has(key.id),
    };
  });

  const environmentItems: ProxyClientKeySummaryItem[] = environmentEntries.map((entry) => {
    const duplicateName = (nameCounts.get(entry.name) || 0) > 1;
    return {
      id: entry.id,
      name: entry.name,
      source: "environment",
      enabled: true,
      editable: false,
      tokenPreview: null,
      notes: null,
      lastRequestAt: activity.get(entry.name) || null,
      lastRequestAtReliable: !duplicateName,
      duplicateName,
      duplicateSource: duplicateEnvironmentTokens.has(entry.token),
    };
  });

  const items = [...databaseItems, ...environmentItems];
  const effectiveTotal = effectiveTokens.size;
  return {
    protectionEnabled: effectiveTotal > 0,
    anonymousMode: effectiveTotal === 0,
    effectiveTotal,
    databaseManagedTotal: databaseKeys.length,
    enabledDatabaseTotal: enabledDatabaseKeys.length,
    environmentManagedTotal: environmentEntries.length,
    duplicateSourceCount: items.filter((item) => item.duplicateSource).length,
    items,
  };
}
