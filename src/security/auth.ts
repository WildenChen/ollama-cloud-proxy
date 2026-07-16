import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/env";
import type { DatabaseStore } from "../storage/database";
import type { ClientIdentity } from "../types/domain";
import { openAiError } from "../errors/responses";
import { apiKeyPreview, KeyCipher } from "./encryption";

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

const ADMIN_PASSWORD_SETTING = "auth.adminPasswordHash";
const HASH_ITERATIONS = 210_000;
const ADMIN_SESSION_COOKIE = "ocp_admin_session";
const ADMIN_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function generateClientToken(): string {
  return `ocp_${randomBytes(32).toString("base64url")}`;
}

export function hashPassword(password: string): string {
  const value = password.trim();
  if (value.length < 8) throw new Error("Admin password must be at least 8 characters");
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(value, salt, HASH_ITERATIONS, 32, "sha256");
  return `pbkdf2-sha256:${HASH_ITERATIONS}:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, iterationsText, saltText, hashText] = stored.split(":");
  if (algorithm !== "pbkdf2-sha256" || !iterationsText || !saltText || !hashText) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const expected = Buffer.from(hashText, "base64");
  const actual = pbkdf2Sync(password.trim(), Buffer.from(saltText, "base64"), iterations, expected.length, "sha256");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isAdminInitialized(store: DatabaseStore): boolean {
  return Boolean(store.getSetting(ADMIN_PASSWORD_SETTING));
}

export function setAdminPassword(store: DatabaseStore, password: string): void {
  store.setSetting(ADMIN_PASSWORD_SETTING, hashPassword(password));
}

function cookieValue(req: Request, name: string): string | null {
  const cookies = req.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [cookieName, ...parts] = item.trim().split("=");
    if (cookieName === name) return parts.join("=") || null;
  }
  return null;
}

function sessionSignature(payload: string, passwordHash: string, secret: string): string {
  return createHmac("sha256", `${secret}:${passwordHash}`).update(payload).digest("base64url");
}

function secureCookieAttribute(req: Request): string {
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return new URL(req.url).protocol === "https:" || forwardedProto === "https" ? "; Secure" : "";
}

export function isAdminAuthenticated(req: Request, store: DatabaseStore, secret: string): boolean {
  const stored = store.getSetting(ADMIN_PASSWORD_SETTING);
  if (!stored) return false;

  const bearer = bearerToken(req);
  if (bearer && verifyPassword(bearer, stored)) return true;

  const session = cookieValue(req, ADMIN_SESSION_COOKIE);
  if (!session) return false;
  const [expiresText, nonce, signature] = session.split(".");
  const expiresAt = Number(expiresText);
  if (!expiresText || !nonce || !signature || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = sessionSignature(`${expiresText}.${nonce}`, stored, secret);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function adminSessionCookie(req: Request, store: DatabaseStore, secret: string): string {
  const stored = store.getSetting(ADMIN_PASSWORD_SETTING);
  if (!stored) throw new Error("Admin password setup required");
  const expiresAt = Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${expiresAt}.${randomBytes(18).toString("base64url")}`;
  const value = `${payload}.${sessionSignature(payload, stored, secret)}`;
  return `${ADMIN_SESSION_COOKIE}=${value}; Path=/admin; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secureCookieAttribute(req)}`;
}

export function clearAdminSessionCookie(req: Request): string {
  return `${ADMIN_SESSION_COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict${secureCookieAttribute(req)}`;
}

export function adminAuthStatus(store: DatabaseStore, req: Request, secret: string) {
  return {
    initialized: isAdminInitialized(store),
    authenticated: isAdminAuthenticated(req, store, secret),
  };
}

export function requireAdmin(req: Request, store: DatabaseStore, secret: string): Response | null {
  const stored = store.getSetting(ADMIN_PASSWORD_SETTING);
  if (!stored) {
    return openAiError(401, "admin_setup_required", "Admin password setup required");
  }
  if (!isAdminAuthenticated(req, store, secret)) {
    return openAiError(401, "unauthorized", "Admin password required");
  }
  return null;
}

export function authenticateClient(
  req: Request,
  config: AppConfig,
  store: DatabaseStore,
  cipher: KeyCipher
): { identity: ClientIdentity } | { response: Response } {
  const token = bearerToken(req);
  const dbKeys = store.listClientApiKeys(false);
  const hasDbClientKeys = dbKeys.some((key) => key.enabled);
  if (token) {
    for (const key of dbKeys) {
      if (!key.enabled) continue;
      try {
        if (cipher.decrypt(key.encryptedToken) === token) {
          return { identity: { clientName: key.name, authenticated: true } };
        }
      } catch {
        continue;
      }
    }
  }
  if (config.clientApiKeys.size > 0 || hasDbClientKeys) {
    const clientName = token ? config.clientApiKeys.get(token) : null;
    if (!clientName) {
      return { response: openAiError(401, "unauthorized", "Valid client token required") };
    }
    return { identity: { clientName, authenticated: true } };
  }

  return {
    identity: {
      clientName: req.headers.get("x-client-name")?.trim() || "anonymous",
      authenticated: false,
    },
  };
}

export function publicTokenPreview(token: string): string {
  return apiKeyPreview(token);
}
