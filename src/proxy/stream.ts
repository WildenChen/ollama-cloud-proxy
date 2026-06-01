type FinalizeInput = {
  ok: boolean;
  aborted: boolean;
  errorType?: string;
};

export function proxyReadableStream(
  upstreamBody: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
  idleTimeoutMs: number,
  totalTimeoutMs: number,
  abortUpstream: () => void,
  finalize: (input: FinalizeInput) => void
): ReadableStream<Uint8Array> | null {
  if (!upstreamBody) {
    finalize({ ok: true, aborted: false });
    return null;
  }

  const reader = upstreamBody.getReader();
  let finished = false;
  let idleTimer: Timer | null = null;
  let totalTimer: Timer | null = null;

  const finish = (input: FinalizeInput) => {
    if (finished) return;
    finished = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (totalTimer) clearTimeout(totalTimer);
    signal.removeEventListener("abort", onAbort);
    finalize(input);
  };

  const resetIdle = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortUpstream();
      controller.error(new Error("upstream_idle_timeout"));
      finish({ ok: false, aborted: false, errorType: "upstream_timeout" });
    }, idleTimeoutMs);
  };

  const onAbort = () => {
    abortUpstream();
    void reader.cancel().catch(() => undefined);
    finish({ ok: false, aborted: true, errorType: "client_aborted" });
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener("abort", onAbort, { once: true });
      totalTimer = setTimeout(() => {
        abortUpstream();
        controller.error(new Error("upstream_total_timeout"));
        finish({ ok: false, aborted: false, errorType: "upstream_timeout" });
      }, totalTimeoutMs);
      resetIdle(controller);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finish({ ok: true, aborted: false });
          return;
        }
        if (value) {
          controller.enqueue(value);
          resetIdle(controller);
        }
      } catch (error) {
        controller.error(error);
        finish({ ok: false, aborted: false, errorType: "stream_error" });
      }
    },
    cancel() {
      abortUpstream();
      finish({ ok: false, aborted: true, errorType: "client_aborted" });
    },
  });
}
