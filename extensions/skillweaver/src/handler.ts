import { createSubsystemLogger } from "./logger.js";
import type { Decomposer } from "./decomposer.js";
import type { Retriever } from "./retriever.js";
import { formatSkillContext } from "./context-injector.js";

const log = createSubsystemLogger("skillweaver/handler");

interface CollectEvent {
  cleanUserMessage?: { content?: unknown };
  messages?: unknown[];
  envelope?: Record<string, unknown> | null;
  prompt?: string;
  storage?: unknown;
}

interface CollectContext {
  sessionKey?: string;
}

// AgentMessage content is either a plain string or an array of typed blocks
// (text/image). Only text blocks carry routable query text. The type === "text"
// gate is deliberately stricter than core's agentMessageText (which accepts any
// block with a string .text): we route only on content pi-ai defines as text.
export function extractMessageText(message: { content?: unknown } | null | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: "text"; text: string } =>
        block != null &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .filter((text) => text.length > 0)
      .join("\n");
  }
  return "";
}

// Mirrors core's isSubagentSessionKey (src/sessions/session-key-utils.ts) exactly:
// legacy "subagent:<name>" prefix, or canonical "agent:<id>:<rest>" where <rest>
// starts with "subagent:". A plain includes(":subagent:") is wrong — an agent whose
// id is literally "subagent" (key "agent:subagent:main") must still be routed.
function parseAgentSessionKeyRest(sessionKey: string): string | null {
  const raw = sessionKey.trim().toLowerCase();
  if (!raw) return null;
  const parts = raw.split(":").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "agent") return null;
  const agentId = parts[1]?.trim();
  const rest = parts.slice(2).join(":");
  if (!agentId || !rest) return null;
  return rest;
}

export function isSubagentSessionKey(sessionKey: string | undefined): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) return false;
  if (raw.toLowerCase().startsWith("subagent:")) return true;
  const rest = parseAgentSessionKeyRest(raw);
  return Boolean(rest?.startsWith("subagent:"));
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
  return async (event: CollectEvent, ctx?: CollectContext): Promise<CollectResult> => {
    if (opts.enabled === false) return {};

    // On core's built-in collect path cleanUserMessage.content is the raw prompt
    // string, so the event.prompt fallback is redundant there; it covers callers
    // that pass image-only or empty message content. event.prompt is the clean
    // pre-envelope prompt (envelope rendering happens after context.collect).
    const text = extractMessageText(event.cleanUserMessage) || (typeof event.prompt === "string" ? event.prompt : "");
    if (!text || text.length < opts.minQueryLength) return {};

    if (isSubagentSessionKey(ctx?.sessionKey)) return {};

    const timeoutMs = opts.decomposerTimeoutMs ?? 30000;
    const retrievalTimeoutMs = opts.retrievalTimeoutMs ?? 30000;
    const ac = new AbortController();
    const retrievalAc = new AbortController();
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
          opts.retriever.buildHintSet(subTasks, retrievalAc.signal),
          retrievalTimeoutMs,
          "retriever.buildHintSet",
          () => retrievalAc.abort(),
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
        opts.retriever.retrieve(subTasks, retrievalAc.signal),
        retrievalTimeoutMs,
        "retriever.retrieve",
        () => retrievalAc.abort(),
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
      retrievalAc.abort();
    }
  };
}
