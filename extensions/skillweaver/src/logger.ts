export interface SubsystemLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export function createSubsystemLogger(_namespace: string): SubsystemLogger {
  const formatMeta = (meta?: Record<string, unknown>): string =>
    meta ? ` ${JSON.stringify(meta)}` : "";
  return {
    info: (msg, meta) => console.log(`[INFO] ${msg}${formatMeta(meta)}`),
    warn: (msg, meta) => console.warn(`[WARN] ${msg}${formatMeta(meta)}`),
    error: (msg, meta) => console.error(`[ERROR] ${msg}${formatMeta(meta)}`),
    debug: (msg, meta) => console.debug(`[DEBUG] ${msg}${formatMeta(meta)}`),
  };
}
