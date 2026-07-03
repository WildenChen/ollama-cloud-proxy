export type OllamaUsageWindow = {
  usedPercent: number;
  remainingPercent: number;
  resetAt: string | null;
};

export type OllamaCloudUsageSnapshot = {
  source: "ollama_cloud_settings";
  status: "ok";
  plan: string | null;
  session: OllamaUsageWindow | null;
  weekly: OllamaUsageWindow | null;
  fetchedAt: string;
};

export type OllamaCloudUsageResult =
  | { ok: true; snapshot: OllamaCloudUsageSnapshot }
  | { ok: false; status: "missing_cookie" | "invalid_cookie" | "expired_cookie" | "upstream_error" | "parse_error" | "network_error"; message: string };

const SESSION_COOKIE_NAME = "__Secure-session";

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function clampPercent(value: unknown): number | null {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}

export function normalizeOllamaUsageCookie(cookie: string | null | undefined): { ok: true; value: string } | { ok: false; message: string } {
  const raw = cookie?.trim();
  if (!raw) return { ok: false, message: "Ollama Cloud usage cookie is not configured." };
  if (raw.includes("\r") || raw.includes("\n")) {
    return { ok: false, message: "Ollama Cloud usage cookie contains invalid CRLF characters." };
  }
  const prefix = `${SESSION_COOKIE_NAME}=`;
  return {
    ok: true,
    value: raw.toLowerCase().startsWith(prefix.toLowerCase()) ? raw.slice(prefix.length).trim() : raw,
  };
}

function extractUsagePercent(trackHtml: string): number | null {
  const tagHeader = trackHtml.match(/^[^>]*/)?.[0] ?? "";
  const ariaMatch = tagHeader.match(/(\d+(?:\.\d+)?)%\s*used/i);
  const ariaPercent = clampPercent(ariaMatch?.[1]);
  if (ariaPercent !== null) return ariaPercent;
  const style = tagHeader.match(/style="([^"]*)"/)?.[1] ?? "";
  return clampPercent(style.match(/(?:^|;)\s*width\s*:\s*([0-9.]+)%/i)?.[1]);
}

export function parseOllamaCloudSettingsHtml(html: string, fetchedAt = new Date().toISOString()): OllamaCloudUsageSnapshot | null {
  const parts = html.split(/\bdata-usage-track\b/);
  if (parts.length < 2) return null;
  const extractTime = (text: string): string | null => {
    const match = text.match(/class="[^"]*local-time[^"]*"[^>]*data-time="([^"]*)"/);
    return match?.[1] || null;
  };
  const windowFromPart = (part: string): OllamaUsageWindow | null => {
    const usedPercent = extractUsagePercent(part);
    if (usedPercent === null) return null;
    return {
      usedPercent,
      remainingPercent: Math.max(0, 100 - usedPercent),
      resetAt: extractTime(part),
    };
  };
  const session = windowFromPart(parts[1]);
  const weekly = parts[2] ? windowFromPart(parts[2]) : null;
  if (!session && !weekly) return null;
  const planTier = html.match(/class="[^"]*capitalize[^"]*"[^>]*>([^<]*)</)?.[1]?.trim() || null;
  return {
    source: "ollama_cloud_settings",
    status: "ok",
    plan: planTier ? `Ollama Cloud ${planTier}` : "Ollama Cloud",
    session,
    weekly,
    fetchedAt,
  };
}

export async function fetchOllamaCloudUsage(input: {
  cookie: string | null | undefined;
  usageUrl: string;
  timeoutMs?: number;
}): Promise<OllamaCloudUsageResult> {
  const normalized = normalizeOllamaUsageCookie(input.cookie);
  if (!normalized.ok) {
    return {
      ok: false,
      status: normalized.message.includes("CRLF") ? "invalid_cookie" : "missing_cookie",
      message: normalized.message,
    };
  }

  try {
    const response = await fetch(input.usageUrl, {
      redirect: "manual",
      headers: {
        Accept: "text/html",
        Cookie: `${SESSION_COOKIE_NAME}=${normalized.value}`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/152.0",
      },
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: "expired_cookie", message: "Ollama Cloud authentication expired. Refresh the usage cookie." };
    }
    if (!response.ok) {
      return { ok: false, status: "upstream_error", message: `Ollama Cloud settings error (${response.status}).` };
    }
    const snapshot = parseOllamaCloudSettingsHtml(await response.text());
    if (!snapshot) {
      return { ok: false, status: "parse_error", message: "Ollama Cloud settings page did not contain usage quota tracks." };
    }
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, status: "network_error", message: `Ollama Cloud quota error: ${(error as Error).message}` };
  }
}

