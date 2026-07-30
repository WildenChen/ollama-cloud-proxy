const ENCODED_PREFIX = "__OCP_SAFE_UPSTREAM_ERROR__:";
const MAX_BODY_CHARS = 8192;
const MAX_STRING_CHARS = 1200;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 30;
const MAX_DEPTH = 5;

export type SafeUpstreamClientError = {
  message: string;
  type: string;
  code: string | number | null;
  requestId: string | null;
  details: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function scalarCode(value: unknown): string | number | null {
  if (typeof value === "string" && value.trim()) return redactSensitiveText(value.trim()).slice(0, 200);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function sensitiveKey(key: string): boolean {
  return /authorization|api.?key|cookie|token|secret|password|session|credential/i.test(key);
}

export function redactSensitiveText(input: string): string {
  return input
    .slice(0, MAX_BODY_CHARS)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bocp_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\b(__Secure-session|ocp_admin_session)\s*=\s*[^;\s,]+/gi, "$1=[REDACTED]")
    .replace(/([?&](?:token|key|api_key|apiKey|access_token|session)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b(authorization|api[-_]?key|apiKey|cookie|token|secret|password|session)\s*[:=]\s*["']?[^\s,;"'}]+/gi, "$1=[REDACTED]")
    .replace(/\/(Users|home)\/[^/\s]+\//g, "/$1/[REDACTED]/");
}

export function sanitizeUpstreamValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactSensitiveText(value).slice(0, MAX_STRING_CHARS);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeUpstreamValue(item, depth + 1));
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      output[key] = sensitiveKey(key) ? "[REDACTED]" : sanitizeUpstreamValue(nested, depth + 1);
    }
    return output;
  }
  return String(value).slice(0, MAX_STRING_CHARS);
}

export function normalizeUpstreamClientError(bodyText: string, status: number): SafeUpstreamClientError {
  const boundedBody = bodyText.slice(0, MAX_BODY_CHARS);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(boundedBody);
  } catch {
    parsed = null;
  }

  const root = isRecord(parsed) ? parsed : null;
  const errorValue = root?.error;
  const errorObject = isRecord(errorValue) ? errorValue : null;
  const source = errorObject ?? root;
  const rawMessage = firstString(
    source?.message,
    root?.message,
    typeof errorValue === "string" ? errorValue : null,
    typeof root?.detail === "string" ? root.detail : null,
    parsed === null ? boundedBody : null
  );
  const message = redactSensitiveText(rawMessage || `Upstream rejected request (${status})`).slice(0, MAX_STRING_CHARS);
  const type =
    firstString(source?.type, root?.type) ||
    (status >= 400 && status < 500 ? "invalid_request_error" : "upstream_error");
  const code = scalarCode(source?.code ?? root?.code);
  const requestId = firstString(
    source?.request_id,
    source?.requestId,
    source?.trace_id,
    source?.traceId,
    root?.request_id,
    root?.requestId,
    root?.trace_id,
    root?.traceId
  );
  const detailsCandidate =
    source?.details ??
    root?.details ??
    (typeof root?.detail === "string" ? null : root?.detail) ??
    source?.param ??
    root?.param ??
    null;

  return {
    message,
    type: redactSensitiveText(type).slice(0, 200),
    code,
    requestId: requestId ? redactSensitiveText(requestId).slice(0, 300) : null,
    details: detailsCandidate === null ? null : sanitizeUpstreamValue(detailsCandidate),
  };
}

export function encodeUpstreamClientError(bodyText: string, status: number): string {
  return `${ENCODED_PREFIX}${JSON.stringify(normalizeUpstreamClientError(bodyText, status))}`;
}

export function decodeUpstreamClientError(message: string): SafeUpstreamClientError | null {
  if (!message.startsWith(ENCODED_PREFIX)) return null;
  try {
    const parsed = JSON.parse(message.slice(ENCODED_PREFIX.length)) as SafeUpstreamClientError;
    if (!parsed || typeof parsed.message !== "string" || typeof parsed.type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
