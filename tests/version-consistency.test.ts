import { describe, expect, test } from "bun:test";
import { APP_VERSION } from "../src/config/version";

describe("release version consistency", () => {
  test("keeps runtime, package, README, and changelog on the same version", async () => {
    const packageJson = await Bun.file("package.json").json();
    const readme = await Bun.file("README.md").text();
    const changelog = await Bun.file("docs/changelog.md").text();

    expect(APP_VERSION).toBe(packageJson.version);
    expect(readme).toContain(`目前版本：\`${APP_VERSION}\``);
    expect(readme).toContain(`"version":"${APP_VERSION}"`);
    expect(changelog).toContain(`## ${APP_VERSION} - `);
  });
});
