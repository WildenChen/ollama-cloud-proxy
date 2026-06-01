import type { AppConfig } from "../config/env";
import type { DatabaseStore } from "../storage/database";

export class ModelManager {
  constructor(
    private readonly config: AppConfig,
    private readonly store: DatabaseStore
  ) {}

  mapModel(model: string | undefined | null): { originalModel: string | null; upstreamModel: string | null } {
    if (!model) return { originalModel: null, upstreamModel: null };
    return {
      originalModel: model,
      upstreamModel: this.config.modelAliases[model] || model,
    };
  }

  applyAliasToBody(rawBody: string): {
    body: string;
    originalModel: string | null;
    upstreamModel: string | null;
  } {
    const parsed = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    const model = typeof parsed.model === "string" ? parsed.model : null;
    const mapped = this.mapModel(model);
    if (mapped.upstreamModel && mapped.upstreamModel !== mapped.originalModel) {
      parsed.model = mapped.upstreamModel;
    }
    return { body: JSON.stringify(parsed), ...mapped };
  }

  aliasesAsModels() {
    return Object.keys(this.config.modelAliases).map((id) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "ollama-cloud-proxy",
    }));
  }

  getCachedModels(): unknown | null {
    const cached = this.store.getModelsCache();
    if (!cached) return null;
    const ageSeconds = (Date.now() - Date.parse(cached.fetchedAt)) / 1000;
    if (ageSeconds > this.config.modelsCacheTtlSeconds) return null;
    try {
      const parsed = JSON.parse(cached.responseJson);
      return this.mergeAliases(parsed);
    } catch {
      return null;
    }
  }

  setCachedModels(response: unknown) {
    this.store.setModelsCache(JSON.stringify(response));
  }

  mergeAliases(response: unknown) {
    if (!response || typeof response !== "object") {
      return { object: "list", data: this.aliasesAsModels() };
    }
    const current = response as { data?: unknown };
    const data = Array.isArray(current.data) ? current.data : [];
    return { ...current, data: [...this.aliasesAsModels(), ...data] };
  }
}
