import type { AppConfig } from "../config/env";
import type { DatabaseStore } from "../storage/database";

export class ModelManager {
  private cacheHits = 0;
  private cacheMisses = 0;

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

  private enabledMap() {
    return new Map(this.store.getModelSettings().map((row) => [String(row.model), Number(row.enabled ?? 1) === 1]));
  }

  isModelEnabled(model: string | null | undefined) {
    if (!model) return true;
    return this.enabledMap().get(model) ?? true;
  }

  setModelEnabled(model: string, enabled: boolean) {
    return this.store.setModelEnabled(model, enabled);
  }

  aliasesAsModels(options: { includeDisabled?: boolean } = {}) {
    const enabled = this.enabledMap();
    return Object.keys(this.config.modelAliases)
      .filter((id) => options.includeDisabled || (enabled.get(id) ?? true))
      .map((id) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "ollama-cloud-proxy",
    }));
  }

  getCachedModels(): unknown | null {
    const cached = this.store.getModelsCache();
    if (!cached) {
      this.cacheMisses += 1;
      return null;
    }
    const ageSeconds = (Date.now() - Date.parse(cached.fetchedAt)) / 1000;
    if (ageSeconds > this.config.modelsCacheTtlSeconds) {
      this.cacheMisses += 1;
      return null;
    }
    try {
      const parsed = JSON.parse(cached.responseJson);
      this.cacheHits += 1;
      return this.mergeAliases(parsed);
    } catch {
      this.cacheMisses += 1;
      return null;
    }
  }

  setCachedModels(response: unknown) {
    this.store.setModelsCache(JSON.stringify(response));
  }

  publicModelsResponse() {
    const models = this.listModelsFromCache().models.map((model) => ({
      id: model.id,
      object: "model",
      created: 0,
      owned_by: model.source === "alias" ? "ollama-cloud-proxy" : "ollama-cloud",
    }));
    return { object: "list", data: models };
  }

  mergeAliases(response: unknown, options: { includeDisabled?: boolean } = {}) {
    const enabled = this.enabledMap();
    if (!response || typeof response !== "object") {
      return { object: "list", data: this.aliasesAsModels(options) };
    }
    const current = response as { data?: unknown };
    const data = Array.isArray(current.data)
      ? current.data.filter((item) => {
          if (options.includeDisabled || !item || typeof item !== "object" || Array.isArray(item)) return true;
          const raw = item as Record<string, unknown>;
          const id = String(raw.id || raw.name || raw.model || "");
          return enabled.get(id) ?? true;
        })
      : [];
    return { ...current, data: [...this.aliasesAsModels(options), ...data] };
  }

  listModelsFromCache(options: { includeAliases?: boolean; includeDisabled?: boolean } = {}) {
    const includeAliases = options.includeAliases ?? true;
    const enabled = this.enabledMap();
    const cached = this.store.getModelsCache();
    let upstreamModels: Array<Record<string, unknown>> = [];
    let source: "cache" | "aliases_only" | "cache_parse_error" = "aliases_only";
    let fetchedAt: string | null = null;
    if (cached) {
      fetchedAt = cached.fetchedAt;
      try {
        const parsed = JSON.parse(cached.responseJson) as { data?: unknown };
        upstreamModels = Array.isArray(parsed.data)
          ? parsed.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
          : [];
        source = "cache";
      } catch {
        source = "cache_parse_error";
      }
    }
    const aliases = includeAliases
      ? Object.entries(this.config.modelAliases).map(([id, upstreamModel]) => ({
          id,
          upstreamModel,
          source: "alias",
          enabled: enabled.get(id) ?? true,
        }))
      : [];
    const models = [
      ...aliases,
      ...upstreamModels.map((model) => ({
        id: String(model.id || model.name || model.model || "unknown"),
        upstreamModel: String(model.id || model.name || model.model || "unknown"),
        source: "upstream",
        enabled: enabled.get(String(model.id || model.name || model.model || "unknown")) ?? true,
      })),
    ].filter((model) => options.includeDisabled || model.enabled);
    return {
      models,
      count: models.length,
      source,
      fetchedAt,
      ttlSeconds: this.config.modelsCacheTtlSeconds,
    };
  }

  ollamaTags() {
    const seen = new Set<string>();
    const models = this.listModelsFromCache({ includeAliases: this.config.ollamaNativeApplyAliases }).models
      .map((model) => String(model.id || "").trim())
      .filter((id) => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((id) => ({
        name: id,
        model: id,
        modified_at: "2026-01-01T00:00:00Z",
        size: 0,
        digest: "proxy",
        details: {
          parent_model: "",
          format: "proxy",
          family: "ollama-cloud-proxy",
          families: ["ollama-cloud-proxy"],
          parameter_size: "unknown",
          quantization_level: "unknown",
        },
      }));
    return { models };
  }

  cacheStats() {
    const cached = this.store.getModelsCache();
    const fetchedAt = cached?.fetchedAt || null;
    const ageSeconds = fetchedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(fetchedAt)) / 1000)) : null;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: this.cacheHits + this.cacheMisses > 0
        ? this.cacheHits / (this.cacheHits + this.cacheMisses)
        : null,
      fetchedAt,
      ageSeconds,
      ttlSeconds: this.config.modelsCacheTtlSeconds,
      valid: ageSeconds !== null && ageSeconds <= this.config.modelsCacheTtlSeconds,
    };
  }
}
