function httpStatusFromError(error) {
  const direct = Number(error?.statusCode);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const nested = Number(error?.response?.statusCode || error?.response?.status);
  if (Number.isFinite(nested) && nested > 0) return nested;
  const match = String(error?.message || '').match(
    /\bstatus code:\s*(\d{3})\b/i,
  );
  return match ? Number(match[1]) : null;
}

export function wrapProviderError(error, summary, hint) {
  const status = httpStatusFromError(error);
  const message = status
    ? `${summary} (HTTP ${status}) — ${hint}`
    : `${summary} — ${hint}`;
  const wrapped = new Error(message, {
    cause: error instanceof Error ? error : undefined,
  });
  wrapped.statusCode = status;
  wrapped.providerHint = hint;
  return wrapped;
}
