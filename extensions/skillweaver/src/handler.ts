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

function withTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${context} timed out after ${ms}ms`)), ms);
      // Ensure the timer is cleaned up if the promise settles first.
      promise.then(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
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

    try {
      const pass1Result = await opts.decomposer.decompose(text, undefined, undefined, ac.signal);
      if (pass1Result.subTasks.length === 0) return {};

      let subTasks = pass1Result.subTasks.filter((s) => s.trim().length > 0);
      if (subTasks.length === 0) return {};
      let actualPass: 1 | 2 = 1;

      if (opts.sadEnabled && !ac.signal.aborted) {
        const hints = await withTimeout(
          opts.retriever.buildHintSet(subTasks),
          retrievalTimeoutMs,
          "retriever.buildHintSet",
        );
        if (hints.length > 0 && !ac.signal.aborted) {
          const pass2Result = await opts.decomposer.decompose(text, hints, undefined, ac.signal);
          const filteredPass2 = pass2Result.subTasks.filter((s) => s.trim().length > 0);
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
