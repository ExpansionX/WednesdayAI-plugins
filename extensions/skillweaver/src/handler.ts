import { createSubsystemLogger } from "./logger.js";
import type { Decomposer } from "./decomposer.js";
import type { Retriever } from "./retriever.js";
import { formatSkillContext } from "./context-injector.js";

const log = createSubsystemLogger("skillweaver/handler");

interface CollectEvent {
  cleanUserMessage?: { text?: string };
  messages?: unknown[];
  envelope?: Record<string, unknown>;
  prompt?: string;
  storage?: unknown;
}

interface CollectResult {
  prependContext?: Array<Record<string, unknown>>;
}

export interface HandlerOptions {
  decomposer: Decomposer;
  retriever: Retriever;
  sadEnabled: boolean;
  minQueryLength: number;
  decomposerModel: string;
  enabled?: boolean;
  decomposerTimeoutMs?: number;
  retrievalTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, context: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.finally(() => {
    if (timer) clearTimeout(timer);
  });

  return Promise.race([
    guarded,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error(`${context} timed out after ${ms}ms`));
      }, ms);
    }),
  ]);
}

export function createCollectHandler(opts: HandlerOptions) {
  return async (event: CollectEvent): Promise<CollectResult> => {
    if (opts.enabled === false) return {};

    const text = event.cleanUserMessage?.text ?? "";
    if (!text || text.length < opts.minQueryLength) return {};

    if (event.envelope != null && typeof event.envelope === "object" && (event.envelope as Record<string, unknown>)["isSubAgent"] === true) return {};

    const timeoutMs = opts.decomposerTimeoutMs ?? 30000;
    const retrievalTimeoutMs = opts.retrievalTimeoutMs ?? 30000;
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), timeoutMs);
    const decomposerDeadline = Date.now() + timeoutMs;
    const remainingDecomposerMs = () => Math.max(1, decomposerDeadline - Date.now());

    try {
      const pass1Result = await withTimeout(
        opts.decomposer.decompose(text, undefined, undefined, ac.signal),
        remainingDecomposerMs(),
        "decomposer.decompose pass 1",
        () => ac.abort(),
      );
      if (pass1Result.subTasks.length === 0) return {};

      let subTasks = pass1Result.subTasks.map((s) => s.trim()).filter((s) => s.length > 0);
      if (subTasks.length === 0) return {};
      let actualPass: 1 | 2 = 1;

      if (opts.sadEnabled && !ac.signal.aborted) {
        const hints = await withTimeout(
          opts.retriever.buildHintSet(subTasks),
          retrievalTimeoutMs,
          "retriever.buildHintSet",
        );
        if (hints.length > 0 && !ac.signal.aborted) {
          const pass2Result = await withTimeout(
            opts.decomposer.decompose(text, hints, undefined, ac.signal),
            remainingDecomposerMs(),
            "decomposer.decompose pass 2",
            () => ac.abort(),
          );
          const filteredPass2 = pass2Result.subTasks.map((s) => s.trim()).filter((s) => s.length > 0);
          if (filteredPass2.length > 0) {
            subTasks = filteredPass2;
            actualPass = 2;
          }
        }
      }

      const results = await withTimeout(
        opts.retriever.retrieve(subTasks),
        retrievalTimeoutMs,
        "retriever.retrieve",
      );
      const contribution = formatSkillContext(results, subTasks, opts.decomposerModel);

      if (contribution.prependContext && contribution.prependContext.length > 0) {
        log.info("routing complete", {
          subTasks: subTasks.length,
          skillsMatched: results.length,
          pass: actualPass,
        });
      }

      return contribution as CollectResult;
    } catch (err) {
      log.warn("handler failed", { error: String(err) });
      return {};
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
