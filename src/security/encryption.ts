import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class KeyCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash("sha256").update(secret).digest();
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
  }

  decrypt(value: string): string {
    const [version, ivText, tagText, encryptedText] = value.split(":");
    if (version !== "v1" || !ivText || !tagText || !encryptedText) {
      throw new Error("Unsupported encrypted key format");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(ivText, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
}

export function apiKeyPreview(apiKey: string): string {
  if (apiKey.length <= 12) return `${apiKey.slice(0, 4)}...${apiKey.slice(-2)}`;
  return `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`;
}

export function redactSecret(value: string): string {
  return apiKeyPreview(value);
}
