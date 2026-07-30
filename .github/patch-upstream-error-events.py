from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "src/proxy/proxyHandler.ts",
    'import { openAiError } from "../errors/responses";',
    'import { openAiError } from "../errors/responses";\nimport { decodeUpstreamClientError } from "../errors/upstreamError";',
)

replace_once(
    "src/proxy/proxyHandler.ts",
    '''        slot.release();
        this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", false, classification.blockReason);
        this.events.emit({
          level: "error",
          type: "request_failed",
          message: "Request failed",
          clientName: client.clientName,
          requestId,
          keyId: key.id,
          keyName: key.name,
          originalModel,
          upstreamModel,
          statusCode: upstream.status,
          durationMs: Date.now() - startedAt,
          details: { errorType: classification.blockReason },
        });''',
    '''        slot.release();
        this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", false, classification.blockReason);
        const safeUpstreamError = decodeUpstreamClientError(classification.message);
        this.events.emit({
          level: "error",
          type: "request_failed",
          message: safeUpstreamError?.message || "Request failed",
          clientName: client.clientName,
          requestId,
          keyId: key.id,
          keyName: key.name,
          originalModel,
          upstreamModel,
          statusCode: upstream.status,
          durationMs: Date.now() - startedAt,
          details: {
            errorType: classification.blockReason,
            ...(safeUpstreamError
              ? {
                  upstreamError: {
                    message: safeUpstreamError.message,
                    type: safeUpstreamError.type,
                    code: safeUpstreamError.code,
                    requestId: safeUpstreamError.requestId,
                    details: safeUpstreamError.details,
                    status: upstream.status,
                  },
                }
              : {}),
          },
        });''',
)

replace_once(
    "tests/upstream-client-errors.test.ts",
    '  return { proxy, store, keyId: key.id };',
    '  return { proxy, store, events, keyId: key.id };',
)

replace_once(
    "tests/upstream-client-errors.test.ts",
    '    const { proxy, store, keyId } = createProxy(() =>',
    '    const { proxy, store, events, keyId } = createProxy(() =>',
)

replace_once(
    "tests/upstream-client-errors.test.ts",
    '''    expect(stored.status).toBe("available");
    expect(stored.consecutiveFailures).toBe(0);''',
    '''    expect(stored.status).toBe("available");
    expect(stored.consecutiveFailures).toBe(0);

    const event = events.list({ type: "request_failed", limit: 10 })[0];
    expect(event.message).toContain("messages[3].tool_calls is invalid");
    expect(event.details.upstreamError).toMatchObject({
      type: "invalid_request_error",
      code: "invalid_tool_calls",
      status: 400,
    });
    expect(JSON.stringify(event)).not.toContain("bearer-secret");
    expect(JSON.stringify(event)).not.toContain("inline-secret");
    expect(JSON.stringify(event)).not.toContain("cookie-secret");''',
)
