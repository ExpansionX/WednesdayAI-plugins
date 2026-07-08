// @ts-expect-error — plugin-sdk not installed in this workspace
import { createSubsystemLogger } from "wednesdayai/plugin-sdk";
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
}

export function createCollectHandler(opts: HandlerOptions) {
  return async (event: CollectEvent): Promise<CollectResult> => {
    if (opts.enabled === false) return {};

    const text = event.cleanUserMessage?.text ?? "";
    if (!text || text.length < opts.minQueryLength) return {};

    if (event.envelope && typeof event.envelope === "object" && (event.envelope as Record<string, unknown>)["isSubAgent"]) return {};

    const timeoutMs = opts.decomposerTimeoutMs ?? 30000;

    try {
      const pass1Controller = new AbortController();
      const pass1Timer = setTimeout(() => pass1Controller.abort(), timeoutMs);
      const pass1Result = await opts.decomposer.decompose(text, undefined, undefined, pass1Controller.signal);
      clearTimeout(pass1Timer);
      if (pass1Result.subTasks.length === 0) return {};

      let subTasks: string[];

      if (opts.sadEnabled && pass1Result.subTasks.length > 0) {
        const hints = await opts.retriever.buildHintSet(pass1Result.subTasks);
        if (hints.length > 0) {
          const pass2Controller = new AbortController();
          const pass2Timer = setTimeout(() => pass2Controller.abort(), timeoutMs);
          const pass2Result = await opts.decomposer.decompose(text, hints, undefined, pass2Controller.signal);
          clearTimeout(pass2Timer);
          subTasks = pass2Result.subTasks.length > 0 ? pass2Result.subTasks : pass1Result.subTasks;
        } else {
          subTasks = pass1Result.subTasks;
        }
      } else {
        subTasks = pass1Result.subTasks;
      }

      const results = await opts.retriever.retrieve(subTasks);
      const contribution = formatSkillContext(results, text, subTasks, opts.decomposerModel);

      if (contribution.prependContext && contribution.prependContext.length > 0) {
        log.info("routing complete", {
          subTasks: subTasks.length,
          skillsMatched: results.length,
          pass: opts.sadEnabled ? 2 : 1,
        });
      }

      return contribution as CollectResult;
    } catch (err) {
      log.warn("handler failed", { error: String(err) });
      return {};
    }
  };
}
