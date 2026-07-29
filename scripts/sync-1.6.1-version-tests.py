from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))

replace_once("README.md", '"version":"1.6.0"', '"version":"1.6.1"')
replace_once(
    "tests/integration.test.ts",
    '    expect(body.proxy_version).toBe("1.6.0");\n',
    '    expect(body.proxy_version).toBe("1.6.1");\n',
)
Path("scripts/sync-1.6.1-version-tests.py").unlink()
