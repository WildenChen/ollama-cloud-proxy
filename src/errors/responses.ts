export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

export function openAiError(
  status: number,
  type: string,
  message: string,
  details?: Record<string, unknown>
): Response {
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
