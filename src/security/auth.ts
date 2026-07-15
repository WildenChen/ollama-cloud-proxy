import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
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

export function adminAuthStatus(store: DatabaseStore) {
  return {
    initialized: isAdminInitialized(store),
  };
}

export function requireAdmin(req: Request, store: DatabaseStore): Response | null {
  const token = bearerToken(req);
  const stored = store.getSetting(ADMIN_PASSWORD_SETTING);
  if (!stored) {
    return openAiError(401, "admin_setup_required", "Admin password setup required");
  }
  if (!token || !verifyPassword(token, stored)) {
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
