import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporaryDirectories: string[] = [];

function runConfig(overrides: Record<string, string>) {
  const code = `
    import { loadConfig } from "./src/config/env.ts";
    try {
      const config = loadConfig();
      console.log(JSON.stringify({
        secretLength: config.keyEncryptionSecret.length,
        clientKeys: config.clientApiKeys.size,
      }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  `;

  return Bun.spawnSync({
    cmd: ["bun", "-e", code],
    cwd: process.cwd(),
    env: {
      ...process.env,
      KEY_ENCRYPTION_SECRET: "0123456789abcdef0123456789abcdef",
      CLIENT_API_KEYS: "",
      ...overrides,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function text(data: Uint8Array) {
  return new TextDecoder().decode(data);
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("startup credential safety", () => {
  test("accepts a strong encryption secret with no env client keys", () => {
    const result = runConfig({});

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(text(result.stdout))).toEqual({
      secretLength: 32,
      clientKeys: 0,
    });
  });

  test("rejects the example encryption secret", () => {
    const result = runConfig({
      KEY_ENCRYPTION_SECRET: "change-this-very-long-random-secret",
    });

    expect(result.exitCode).not.toBe(0);
    expect(text(result.stderr)).toContain("openssl rand -hex 32");
  });

  test("rejects example client tokens", () => {
    const result = runConfig({
      CLIENT_API_KEYS: "openclaw:change-this-openclaw-token",
    });

    expect(result.exitCode).not.toBe(0);
    expect(text(result.stderr)).toContain("insecure example token");
  });
});

describe("environment initializer", () => {
  test("generates a secret once without overwriting existing settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "ollama-cloud-proxy-env-"));
    temporaryDirectories.push(directory);
    writeFileSync(
      join(directory, ".env.example"),
      "PORT=11435\nKEY_ENCRYPTION_SECRET=\nCLIENT_API_KEYS=\nCUSTOM_VALUE=keep-me\n",
    );

    const script = resolve(process.cwd(), "scripts/init-env.sh");
    const first = Bun.spawnSync({
      cmd: ["sh", script],
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(first.exitCode).toBe(0);
    const initialized = readFileSync(join(directory, ".env"), "utf8");
    expect(initialized).toMatch(/KEY_ENCRYPTION_SECRET=[a-f0-9]{64}/);
    expect(initialized).toContain("CUSTOM_VALUE=keep-me");

    const second = Bun.spawnSync({
      cmd: ["sh", script],
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(second.exitCode).toBe(0);
    expect(readFileSync(join(directory, ".env"), "utf8")).toBe(initialized);
  });
});
