import { decodeUpstreamClientError } from "./upstreamError";

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

export function openAiError(
  status: number,
  type: string,
  message: string,
  details?: Record<string, unknown>
): Response {
  const upstreamError = decodeUpstreamClientError(message);
  if (upstreamError) {
    return json(
      {
        error: {
          message: upstreamError.message,
          type: upstreamError.type,
          ...(upstreamError.code !== null ? { code: upstreamError.code } : {}),
          upstream_status: status,
          ...(upstreamError.requestId ? { request_id: upstreamError.requestId } : {}),
          ...(upstreamError.details !== null ? { details: upstreamError.details } : {}),
        },
      },
      status
    );
  }

  return json(
    {
      error: {
        message,
        type,
        ...(details ? { details } : {}),
      },
    },
    status
  );
}

export function notFound(): Response {
  return openAiError(404, "not_found", "Not Found");
}
