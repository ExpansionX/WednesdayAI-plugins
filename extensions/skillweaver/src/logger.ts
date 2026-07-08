export interface SubsystemLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export function createSubsystemLogger(_namespace: string): SubsystemLogger {
  return {
    info: (msg: string, meta?: Record<string, unknown>) => console.log(`[INFO] ${msg}`, meta ?? ""),
    warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[WARN] ${msg}`, meta ?? ""),
    error: (msg: string, meta?: Record<string, unknown>) => console.error(`[ERROR] ${msg}`, meta ?? ""),
    debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[DEBUG] ${msg}`, meta ?? ""),
  };
}
