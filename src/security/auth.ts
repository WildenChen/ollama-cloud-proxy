import type { AppConfig } from "../config/env";
import type { ClientIdentity } from "../types/domain";
import { openAiError } from "../errors/responses";

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function requireAdmin(req: Request, config: AppConfig): Response | null {
  const token = bearerToken(req);
  if (token !== config.adminToken) {
    return openAiError(401, "unauthorized", "Admin token required");
  }
  return null;
}

export function authenticateClient(
  req: Request,
  config: AppConfig
): { identity: ClientIdentity } | { response: Response } {
  const token = bearerToken(req);
  if (config.clientApiKeys.size > 0) {
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
