export function deriveServiceReadiness(input = {}) {
  const initialized = input.initialized === true;
  const authenticated = input.authenticated === true;
  const totalKeys = Math.max(0, Number(input.totalKeys || 0));
  const availableKeys = Math.max(0, Number(input.availableKeys || 0));
  const enabledClientKeys = Math.max(0, Number(input.enabledClientKeys || 0));
  const modelCount = Math.max(0, Number(input.modelCount || 0));
  const usageCookieCount = Math.max(0, Number(input.usageCookieCount || 0));
  const loadError = input.loadError === true;

  const steps = {
    adminReady: initialized && authenticated,
    upstreamKeyReady: totalKeys > 0,
    clientKeyReady: enabledClientKeys > 0,
    proxyReady: availableKeys > 0,
    modelDiscoveryReady: modelCount > 0,
    usageCookieReady: usageCookieCount > 0,
  };

  const requiredComplete =
    steps.adminReady &&
    steps.upstreamKeyReady &&
    steps.clientKeyReady &&
    steps.proxyReady &&
    steps.modelDiscoveryReady;

  let status = "ready";
  let nextAction = "none";

  if (loadError) {
    status = "error";
    nextAction = "refresh";
  } else if (!initialized || !authenticated) {
    status = "setup";
    nextAction = "sign-in";
  } else if (!steps.upstreamKeyReady) {
    status = "setup";
    nextAction = "add-key";
  } else if (!steps.clientKeyReady) {
    status = "setup";
    nextAction = "create-client-key";
  } else if (!steps.proxyReady) {
    status = "unavailable";
    nextAction = "refresh";
  } else if (!steps.modelDiscoveryReady) {
    status = "partial";
    nextAction = "test-models";
  } else if (availableKeys < totalKeys) {
    status = "partial";
    nextAction = "review-keys";
  }

  return {
    status,
    nextAction,
    requiredComplete,
    steps,
    counts: {
      totalKeys,
      availableKeys,
      enabledClientKeys,
      modelCount,
      usageCookieCount,
    },
  };
}
