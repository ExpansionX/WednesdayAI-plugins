import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = path.resolve(import.meta.dirname, "..", "scripts", "xai-spend-boundary.mjs");
const tempRoots: string[] = [];
const children: ChildProcess[] = [];
const servers: http.Server[] = [];

const makeTempRoot = (name: string): string => {
  const root = path.join(tmpdir(), `shohin-${name}-${process.pid}-${Date.now()}-${tempRoots.length}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  tempRoots.push(root);
  return root;
};

const startFakeUpstream = async (
  delayMs = 0,
): Promise<{ readonly baseUrl: string; readonly requests: unknown[] }> => {
  const requests: unknown[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      requests.push({
        body: Buffer.concat(chunks).toString("utf-8"),
        headers: request.headers,
        method: request.method,
        url: request.url,
      });
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        id: "resp_fake",
        model: "grok-4.6",
        object: "response",
        output: [{ content: [{ text: "ok", type: "output_text" }], role: "assistant", type: "message" }],
        usage: {
          cost_in_usd_ticks: 999999999999999,
          input_tokens: 999999999,
          output_tokens: 999999999,
          total_tokens: 1999999998,
        },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("fake upstream did not bind");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
};

const makePolicy = (root: string, upstreamBaseUrl: string, overrides: Record<string, unknown> = {}) => ({
  allowed: {
    apiModel: "grok-4.6",
    contentType: "application/json",
    maxConcurrent: 1,
    maxOutputTokens: 20_000,
    maxRequests: 20,
    maxSerializedBodyBytes: 100_000,
    maxServerSideToolInvocations: 0,
    method: "POST",
    openCodeModel: "xai/grok-4.6",
    route: "/v1/responses",
  },
  listen: { host: "127.0.0.1", port: 19_000 + tempRoots.length },
  logPath: path.join(root, "events.jsonl"),
  mode: "test",
  policyVersion: "xai-grok-4.6-local-forwarder-v1",
  pricing: {
    cachedInputUsdPerMillionTokens: 1,
    capUsd: 12.8,
    inputUsdPerMillionTokens: 4,
    longContextThresholdTokens: 200_000,
    outputUsdPerMillionTokens: 12,
    perRequestMaxUsd: 0.64,
    priorityMultiplier: 2,
    reviewedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    wholeRunMaxUsd: 12.8,
  },
  readyPath: path.join(root, "ready.json"),
  statePath: path.join(root, "state.json"),
  upstream: { baseUrl: upstreamBaseUrl, noRedirect: true },
  ...overrides,
});

const startBoundary = async (root: string, policy: unknown): Promise<{ readonly baseUrl: string; readonly child: ChildProcess }> => {
  const policyPath = path.join(root, "policy.json");
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}
`, { mode: 0o600 });
  const readyPath = (policy as { readyPath: string }).readyPath;
  rmSync(readyPath, { force: true });
  const child = spawn(process.execPath, [scriptPath, policyPath], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(readyPath)) {
      const ready = JSON.parse(readFileSync(readyPath, "utf-8")) as { baseURL: string };
      return { baseUrl: ready.baseURL, child };
    }
    if (child.exitCode !== null) {
      throw new Error(`boundary exited early: ${child.exitCode}`);
    }
    await sleep(20);
  }
  throw new Error("boundary did not become ready");
};

const stopBoundary = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
};

const postResponses = async (baseUrl: string, body: unknown, init: RequestInit = {}) => fetch(`${baseUrl}/responses`, {
  body: typeof body === "string" ? body : JSON.stringify(body),
  headers: {
    authorization: "Bearer fake-secret-token",
    "content-type": "application/json",
    ...(init.headers ?? {}),
  },
  method: "POST",
  ...init,
});

const validBody = () => ({
  include: ["reasoning.encrypted_content"],
  input: [{ content: [{ text: "hello", type: "input_text" }], role: "user" }],
  max_output_tokens: 20_000,
  model: "grok-4.6",
  store: false,
  stream: true,
});

const titleBody = () => ({
  ...validBody(),
  input: [
    { content: "title system", role: "system" },
    { content: [{ text: "Generate a title", type: "input_text" }], role: "user" },
    { content: [{ text: "Reply with ok.", type: "input_text" }], role: "user" },
  ],
  reasoning: { effort: "low" },
  temperature: 0.5,
});

const toolFixturePath = path.resolve(import.meta.dirname, "paid-boundary-opencode-tools.fixture.json");

const localTools = (): Array<Record<string, unknown>> =>
  JSON.parse(readFileSync(toolFixturePath, "utf-8")) as Array<Record<string, unknown>>;

const toolBody = () => ({
  ...validBody(),
  tools: localTools(),
  tool_choice: "auto",
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    await stopBoundary(child);
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("xAI paid spend boundary", () => {
  it("allows only the reviewed local fake xAI Responses route and records a durable reservation", async () => {
    const root = makeTempRoot("paid-boundary-success");
    const upstream = await startFakeUpstream();
    const policy = makePolicy(root, upstream.baseUrl);
    const boundary = await startBoundary(root, policy);

    const serialized = JSON.stringify(titleBody());
    const response = await postResponses(boundary.baseUrl, serialized);

    expect(response.status).toBe(200);
    expect(upstream.requests).toHaveLength(1);
    const forwarded = upstream.requests[0] as { readonly url: string; readonly body: string };
    expect(forwarded.url).toBe("/v1/responses");
    expect(forwarded.body).toBe(serialized);
    expect(JSON.parse(forwarded.body)).toMatchObject({
      max_output_tokens: 20_000,
      model: "grok-4.6",
      reasoning: { effort: "low" },
      store: false,
      stream: true,
    });
    expect(JSON.parse(readFileSync(path.join(root, "state.json"), "utf-8"))).toMatchObject({
      forwardedCount: 1,
      inFlight: 0,
      totalReservedUsd: 0.64,
    });
  });

  it("allows the frozen local OpenCode function tool set and function-result follow-up items", async () => {
    const root = makeTempRoot("paid-boundary-tools");
    const upstream = await startFakeUpstream();
    const policy = makePolicy(root, upstream.baseUrl);
    const boundary = await startBoundary(root, policy);

    expect((await postResponses(boundary.baseUrl, toolBody())).status).toBe(200);
    const followUp = {
      ...toolBody(),
      input: [
        { content: [{ text: "use glob", type: "input_text" }], role: "user" },
        { type: "function_call", call_id: "call_1", name: "glob", arguments: "{\"pattern\":\"*.ts\"}", status: "completed" },
        { type: "function_call_output", call_id: "call_1", output: "[]", status: "completed" },
      ],
    };
    expect((await postResponses(boundary.baseUrl, followUp)).status).toBe(200);
    expect(upstream.requests).toHaveLength(2);
    expect(JSON.parse(readFileSync(path.join(root, "state.json"), "utf-8"))).toMatchObject({
      forwardedCount: 2,
      totalReservedUsd: 1.28,
    });
  });

  it("rejects wrong route, model, body size, missing limits, malformed limits and server-side tools before upstream dispatch", async () => {
    const root = makeTempRoot("paid-boundary-negatives");
    const upstream = await startFakeUpstream();
    const policy = makePolicy(root, upstream.baseUrl);
    const boundary = await startBoundary(root, policy);

    const cases: Array<readonly [string, () => Promise<Response>, string]> = [
      ["wrong route", () => fetch(`${boundary.baseUrl}/chat/completions`, { method: "POST" }), "route_not_allowed"],
      ["wrong model", () => postResponses(boundary.baseUrl, { ...validBody(), model: "grok-4.5" }), "model_not_allowed"],
      ["missing limit", () => postResponses(boundary.baseUrl, { ...validBody(), max_output_tokens: undefined }), "output_limit_missing"],
      ["malformed limit", () => postResponses(boundary.baseUrl, { ...validBody(), max_output_tokens: 20_001 }), "output_limit_malformed"],
      ["server web search tool", () => postResponses(boundary.baseUrl, { ...validBody(), tools: [{ type: "web_search" }], tool_choice: "auto" }), "server_side_tools_denied"],
      ["oversized", () => postResponses(boundary.baseUrl, JSON.stringify({ ...validBody(), prompt: "x".repeat(101_000) })), "serialized_body_too_large"],
    ];

    for (const [_name, request, reason] of cases) {
      const response = await request();
      expect(response.status).toBeGreaterThanOrEqual(400);
      await expect(response.json()).resolves.toMatchObject({ reason });
    }
    expect(upstream.requests).toHaveLength(0);
  });

  it("rejects ambiguous, noncanonical, duplicate and forged output-limit fields before upstream dispatch", async () => {
    const root = makeTempRoot("paid-boundary-limit-aliases");
    const upstream = await startFakeUpstream();
    const policy = makePolicy(root, upstream.baseUrl);
    const boundary = await startBoundary(root, policy);

    const cases: Array<readonly [string, unknown]> = [
      ["chat max completion only", { ...validBody(), max_output_tokens: undefined, max_completion_tokens: 20_000 }],
      ["safe canonical with unsafe chat alias", { ...validBody(), max_completion_tokens: 20_001 }],
      ["unsafe canonical with safe legacy", { ...validBody(), max_output_tokens: 20_001, max_tokens: 20 }],
      ["equal canonical and camel alias", { ...validBody(), maxOutputTokens: 20_000 }],
      ["unsupported generation alias", { ...validBody(), max_new_tokens: 20_000 }],
      ["nested forged legacy", { ...validBody(), provider_options: { xai: { max_tokens: 20_001 } } }],
      ["nested forged canonical", { ...validBody(), metadata: { max_output_tokens: 1 } }],
      ["duplicate canonical keys equal", `{"model":"grok-4.6","input":[{"role":"user","content":[{"type":"input_text","text":"hi"}]}],"max_output_tokens":20000,"max_output_tokens":20000,"store":false,"include":["reasoning.encrypted_content"],"stream":true}`],
      ["duplicate escaped legacy keys", `{"model":"grok-4.6","input":[],"max_\u0074okens":20,"max_\u0074okens":20,"store":false,"include":["reasoning.encrypted_content"],"stream":true}`],
    ];

    for (const [_name, body] of cases) {
      const response = await postResponses(boundary.baseUrl, body);
      expect(response.status).toBe(400);
      const json = await response.json() as { reason: string };
      expect(["output_limit_ambiguous", "request_shape_ambiguous"]).toContain(json.reason);
    }
    expect(upstream.requests).toHaveLength(0);
  });

  it("rejects malformed canonical output-limit values before upstream dispatch", async () => {
    const root = makeTempRoot("paid-boundary-limit-values");
    const upstream = await startFakeUpstream();
    const policy = makePolicy(root, upstream.baseUrl);
    const boundary = await startBoundary(root, policy);

    const cases = [null, 0, "20000", 20_000.5, -1];
    for (const limit of cases) {
      const response = await postResponses(boundary.baseUrl, {
        ...validBody(),
        max_output_tokens: limit,
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ reason: "output_limit_malformed" });
    }
    expect(upstream.requests).toHaveLength(0);
  });

  it("rejects multipliers, retention, unknown fields, tool drift and raw duplicate keys before upstream dispatch", async () => {
    const root = makeTempRoot("paid-boundary-request-shape");
    const upstream = await startFakeUpstream();
    const policy = makePolicy(root, upstream.baseUrl);
    const boundary = await startBoundary(root, policy);
    const driftedTools = localTools();
    driftedTools[0] = { ...driftedTools[0], name: "unknown" };
    const driftedSchema = localTools();
    driftedSchema[0] = {
      ...driftedSchema[0],
      parameters: { ...(driftedSchema[0]!.parameters as Record<string, unknown>), additionalProperties: false },
    };

    const cases: Array<readonly [string, unknown, string]> = [
      ["n one", { ...validBody(), n: 1 }, "request_field_not_allowed"],
      ["background", { ...validBody(), background: true }, "request_field_not_allowed"],
      ["previous response", { ...validBody(), previous_response_id: "resp_1" }, "request_field_not_allowed"],
      ["service tier", { ...validBody(), service_tier: "default" }, "request_field_not_allowed"],
      ["modalities", { ...validBody(), modalities: ["text"] }, "request_field_not_allowed"],
      ["store true", { ...validBody(), store: true }, "store_required_false"],
      ["stream false", { ...validBody(), stream: false }, "stream_shape_not_allowed"],
      ["include empty", { ...validBody(), include: [] }, "include_shape_not_allowed"],
      ["reasoning xhigh", { ...validBody(), reasoning: { effort: "xhigh" } }, "reasoning_not_allowed"],
      ["temperature drift", { ...validBody(), temperature: 0.7 }, "temperature_not_allowed"],
      ["tool choice object", { ...toolBody(), tool_choice: { type: "function", name: "glob" } }, "tool_choice_not_allowed"],
      ["tool name drift", { ...toolBody(), tools: driftedTools }, "local_tools_not_allowed"],
      ["tool schema drift", { ...toolBody(), tools: driftedSchema }, "local_tool_schema_not_allowed"],
      ["unknown", { ...validBody(), undocumented_multiplier: true }, "request_field_not_allowed"],
      ["duplicate model keys", `{"model":"grok-4.5","model":"grok-4.6","input":[{"role":"user","content":[{"type":"input_text","text":"hi"}]}],"max_output_tokens":20000,"store":false,"include":["reasoning.encrypted_content"],"stream":true}`, "request_shape_ambiguous"],
      ["prototype key", `{"model":"grok-4.6","input":[{"role":"user","content":[{"type":"input_text","text":"hi"}]}],"max_output_tokens":20000,"store":false,"include":["reasoning.encrypted_content"],"stream":true,"__proto__":{}}`, "prototype_key_denied"],
    ];

    for (const [_name, body, reason] of cases) {
      const response = await postResponses(boundary.baseUrl, body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ reason });
    }
    expect(upstream.requests).toHaveLength(0);
  });

  it("rejects unsafe nested input, media, URL, encrypted and provider shapes before upstream dispatch", async () => {
    const root = makeTempRoot("paid-boundary-input-shape");
    const upstream = await startFakeUpstream();
    const policy = makePolicy(root, upstream.baseUrl);
    const boundary = await startBoundary(root, policy);

    const cases: Array<readonly [string, unknown, string]> = [
      ["input missing", { ...validBody(), input: undefined }, "input_malformed"],
      ["input empty", { ...validBody(), input: [] }, "input_malformed"],
      ["message unknown key", { ...validBody(), input: [{ role: "user", content: "hello", name: "caller" }] }, "message_shape_not_allowed"],
      ["tool role", { ...validBody(), input: [{ role: "tool", content: "ok", tool_call_id: "call_1" }] }, "message_shape_not_allowed"],
      ["image content", { ...validBody(), input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.invalid/a.png" }] }] }, "message_shape_not_allowed"],
      ["file content", { ...validBody(), input: [{ role: "user", content: [{ type: "input_file", file_id: "file_123" }] }] }, "message_shape_not_allowed"],
      ["url content", { ...validBody(), input: [{ role: "user", content: [{ type: "input_text", text: "hello", url: "https://example.invalid" }] }] }, "message_shape_not_allowed"],
      ["encrypted reasoning input", { ...validBody(), input: [{ type: "reasoning", encrypted_content: "opaque" }] }, "input_item_shape_not_allowed"],
      ["unknown function call", { ...validBody(), input: [{ type: "function_call", call_id: "call_1", name: "bash", arguments: "{}" }] }, "local_tool_call_not_allowed"],
      ["function output object", { ...validBody(), input: [{ type: "function_call_output", call_id: "call_1", output: { ok: true } }] }, "local_tool_call_not_allowed"],
      ["nested prototype", `{"model":"grok-4.6","input":[{"role":"user","content":{"__proto__":{}}}],"max_output_tokens":20000,"store":false,"include":["reasoning.encrypted_content"],"stream":true}`, "prototype_key_denied"],
      ["duplicate nested keys", `{"model":"grok-4.6","input":[{"role":"user","content":[{"type":"input_file","file_id":"file_123"}],"content":"hello"}],"max_output_tokens":20000,"store":false,"include":["reasoning.encrypted_content"],"stream":true}`, "request_shape_ambiguous"],
    ];

    for (const [_name, body, reason] of cases) {
      const response = await postResponses(boundary.baseUrl, body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ reason });
    }
    expect(upstream.requests).toHaveLength(0);
  });

  it("serializes concurrency and refuses before cumulative reserved spend exceeds the run cap across restart", async () => {
    const root = makeTempRoot("paid-boundary-recovery");
    const upstream = await startFakeUpstream(150);
    const policy = makePolicy(root, upstream.baseUrl);
    const first = await startBoundary(root, policy);

    const [a, b] = await Promise.all([
      postResponses(first.baseUrl, validBody()),
      postResponses(first.baseUrl, validBody()),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect(upstream.requests).toHaveLength(1);
    await stopBoundary(first.child);

    const second = await startBoundary(root, policy);
    for (let index = 0; index < 19; index += 1) {
      expect((await postResponses(second.baseUrl, validBody())).status).toBe(200);
    }
    const exhausted = await postResponses(second.baseUrl, validBody());
    expect(exhausted.status).toBe(429);
    await expect(exhausted.json()).resolves.toMatchObject({ reason: "request_count_exhausted" });
    expect(JSON.parse(readFileSync(path.join(root, "state.json"), "utf-8"))).toMatchObject({
      forwardedCount: 20,
      totalReservedUsd: 12.8,
    });
  });

  it("fails closed on stale pricing and poisoned in-flight recovery state", async () => {
    const upstream = await startFakeUpstream();
    const staleRoot = makeTempRoot("paid-boundary-stale");
    const stalePolicy = makePolicy(staleRoot, upstream.baseUrl, {
      pricing: {
        ...(makePolicy(staleRoot, upstream.baseUrl).pricing as Record<string, unknown>),
        validUntil: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    await expect(startBoundary(staleRoot, stalePolicy)).rejects.toThrow(/exited early/);

    const poisonedRoot = makeTempRoot("paid-boundary-poisoned");
    const poisonedPolicy = makePolicy(poisonedRoot, upstream.baseUrl);
    writeFileSync(poisonedPolicy.statePath, JSON.stringify({
      forwardedCount: 1,
      inFlight: 1,
      reservations: [],
      totalReservedUsd: 0.64,
      version: 1,
    }));
    await expect(startBoundary(poisonedRoot, poisonedPolicy)).rejects.toThrow(/exited early/);
  });

  it("keeps logs secret-safe while exposing hashes, reasons and limits", async () => {
    const root = makeTempRoot("paid-boundary-redaction");
    const upstream = await startFakeUpstream();
    const policy = makePolicy(root, upstream.baseUrl);
    const boundary = await startBoundary(root, policy);

    const refusal = await postResponses(boundary.baseUrl, {
      ...validBody(),
      input: [{ content: [{ text: "SUPER_SECRET_PROMPT", type: "input_text" }], role: "user" }],
      model: "grok-4.5",
    }, { headers: { authorization: "Bearer secret-token-for-redaction", "content-type": "application/json" } });
    await refusal.text();
    await sleep(20);

    const log = readFileSync(path.join(root, "events.jsonl"), "utf-8");
    expect(log).toContain("model_not_allowed");
    expect(log).toContain("bodySha256");
    expect(log).toContain("wholeRunMaxUsd");
    expect(log).not.toContain("secret-token-for-redaction");
    expect(log).not.toContain("SUPER_SECRET_PROMPT");
  });
});
