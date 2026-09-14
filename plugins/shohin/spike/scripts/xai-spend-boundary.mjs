#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import path from "node:path";

const policyVersion = "xai-grok-4.6-local-forwarder-v1";
const allowedRoute = "/v1/chat/completions";
const allowedMethod = "POST";
const allowedContentType = "application/json";
const openCodeModel = "xai/grok-4.6";
const apiModel = "grok-4.6";
const productionUpstream = "https://api.x.ai/v1";
const serverSideToolKeys = new Set([
  "code_execution",
  "code_interpreter",
  "collections_search",
  "file_search",
  "function_call",
  "functions",
  "mcp_servers",
  "remote_mcp",
  "search_parameters",
  "tools",
  "tool_choice",
  "web_search",
  "web_search_options",
  "x_search",
]);
const canonicalOutputLimitKey = "max_completion_tokens";
const outputLimitFieldKeys = new Set([
  canonicalOutputLimitKey,
  "completionTokens",
  "completion_tokens",
  "maxCompletionTokens",
  "maxGeneratedTokens",
  "maxNewTokens",
  "maxOutputTokens",
  "maxResponseTokens",
  "maxTokens",
  "max_completion_token",
  "max_generated_tokens",
  "max_new_tokens",
  "max_output_tokens",
  "max_response_tokens",
  "max_tokens",
  "max_tokens_to_sample",
  "outputTokens",
  "output_limit",
  "output_tokens",
  "responseTokens",
  "response_tokens",
  "token_limit",
]);
const outputLimitFieldPatterns = [
  /^max(?:completion|generated|generation|new|output|response)?tokens?$/,
  /^max(?:completion|output|response)?length$/,
  /^max(?:tokens?to(?:generate|sample))$/,
  /^(?:completion|generated|generation|new|output|response)tokens?(?:limit)?$/,
  /^tokens?(?:limit|to(?:generate|sample))$/,
  /^num(?:output|predict)$/,
];

const policyPath = process.argv[2];
if (!policyPath) {
  console.error("usage: xai-spend-boundary.mjs <policy.json>");
  process.exit(2);
}

let server;
let gate = Promise.resolve();

const main = async () => {
  const policy = validatePolicy(readJson(policyPath, "policy"));
  const initialState = readState(policy);
  if (initialState.inFlight !== 0) {
    throw new BoundaryError(
      "state_unknown",
      "refusing startup with an unfinished in-flight request",
    );
  }
  logEvent(policy, "startup", {
    bodySha256: sha256(readFileSync(policyPath)),
    forwardedCount: initialState.forwardedCount,
    limitMaxRequests: policy.allowed.maxRequests,
    wholeRunMaxUsd: policy.pricing.wholeRunMaxUsd,
  });

  server = http.createServer((request, response) => {
    handleRequest(policy, request, response).catch((error) => {
      const reason = error instanceof BoundaryError ? error.code : "boundary_internal_error";
      writeJsonResponse(response, 500, { error: "boundary_refused", reason });
      logEvent(policy, "refused", { reason });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(policy.listen.port, policy.listen.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new BoundaryError("listen_failed", "boundary did not bind a TCP port");
  }
  atomicWriteJson(policy.readyPath, {
    baseURL: `http://${policy.listen.host}:${address.port}/v1`,
    host: policy.listen.host,
    port: address.port,
    ready: true,
    route: allowedRoute,
  });
  logEvent(policy, "ready", { host: policy.listen.host, port: address.port });
};

const handleRequest = async (policy, request, response) => {
  if (request.method !== allowedMethod || request.url !== allowedRoute) {
    await rejectRequest(policy, response, 404, "route_not_allowed", {
      method: request.method ?? "",
      route: request.url ?? "",
    });
    return;
  }
  const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.split(";")[0].trim().startsWith(allowedContentType)) {
    await rejectRequest(policy, response, 415, "content_type_not_allowed", { contentType });
    return;
  }
  const authorization = String(request.headers.authorization ?? "");
  if (!authorization.startsWith("Bearer ") || authorization.length <= "Bearer ".length) {
    await rejectRequest(policy, response, 401, "authorization_missing", {});
    return;
  }

  let body;
  try {
    body = await readBoundedBody(request, policy.allowed.maxSerializedBodyBytes);
  } catch (error) {
    await rejectRequest(policy, response, 413, "serialized_body_too_large", {});
    return;
  }

  const bodySha256 = sha256(body);
  const rawBody = body.toString("utf-8");
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    await rejectRequest(policy, response, 400, "json_malformed", { bodySha256 });
    return;
  }
  const shape = validateRequestShape(parsed, rawBody);
  if (!shape.ok) {
    await rejectRequest(policy, response, 400, shape.reason, { bodySha256 });
    return;
  }

  const reservation = await withGate(async () => reserveBeforeForwarding(policy, bodySha256));
  if (!reservation.ok) {
    await rejectRequest(policy, response, reservation.status, reservation.reason, {
      bodySha256,
      forwardedCount: reservation.forwardedCount,
    });
    return;
  }

  const requestId = randomUUID();
  logEvent(policy, "forwarding", {
    bodySha256,
    forwardedCount: reservation.forwardedCount,
    requestId,
  });

  try {
    const upstream = await fetch(joinUpstream(policy.upstream.baseUrl), {
      body,
      headers: forwardHeaders(request.headers, requestId),
      method: allowedMethod,
      redirect: "manual",
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    if (upstream.status >= 300 && upstream.status < 400) {
      logEvent(policy, "upstream_redirect_rejected", {
        requestId,
        status: upstream.status,
      });
      writeJsonResponse(response, 502, {
        error: "boundary_refused",
        reason: "upstream_redirect_rejected",
      });
      return;
    }
    copyResponseHeaders(upstream.headers, response);
    response.statusCode = upstream.status;
    response.end(responseBody);
    logEvent(policy, "forwarded", {
      costInUsdTicksPresent: extractCostInUsdTicks(responseBody) !== undefined,
      responseBodySha256: sha256(responseBody),
      requestId,
      status: upstream.status,
    });
  } catch (error) {
    writeJsonResponse(response, 502, {
      error: "boundary_refused",
      reason: "upstream_unavailable",
    });
    logEvent(policy, "upstream_error", {
      errorName: error instanceof Error ? error.name : "unknown",
      requestId,
    });
  } finally {
    await withGate(async () => releaseInFlight(policy));
  }
};

const reserveBeforeForwarding = (policy, bodySha256) => {
  const state = readState(policy);
  if (state.poisoned === true || state.inFlight !== 0) {
    return {
      forwardedCount: state.forwardedCount,
      ok: false,
      reason: "concurrent_request",
      status: 429,
    };
  }
  if (state.forwardedCount >= policy.allowed.maxRequests) {
    return {
      forwardedCount: state.forwardedCount,
      ok: false,
      reason: "request_count_exhausted",
      status: 429,
    };
  }
  const projected = roundUsd(state.totalReservedUsd + policy.pricing.perRequestMaxUsd);
  if (projected > policy.pricing.capUsd) {
    return {
      forwardedCount: state.forwardedCount,
      ok: false,
      reason: "budget_would_exceed_cap",
      status: 402,
    };
  }
  const next = {
    ...state,
    forwardedCount: state.forwardedCount + 1,
    inFlight: 1,
    reservations: [
      ...state.reservations,
      {
        at: nowIso(),
        bodySha256,
        reservedUsd: policy.pricing.perRequestMaxUsd,
        sequence: state.forwardedCount + 1,
      },
    ],
    totalReservedUsd: projected,
    updatedAt: nowIso(),
  };
  atomicWriteJson(policy.statePath, next);
  return {
    forwardedCount: next.forwardedCount,
    ok: true,
  };
};

const releaseInFlight = (policy) => {
  const state = readState(policy);
  atomicWriteJson(policy.statePath, {
    ...state,
    inFlight: 0,
    updatedAt: nowIso(),
  });
};

const validateRequestShape = (value, rawBody) => {
  if (!isRecord(value)) {
    return { ok: false, reason: "request_shape_not_object" };
  }
  if (value.model !== apiModel) {
    return { ok: false, reason: "model_not_allowed" };
  }
  const rawOutputLimitFields = collectOutputLimitPropertyNames(rawBody);
  if (!rawOutputLimitFields.ok) {
    return { ok: false, reason: "json_malformed" };
  }
  const topLevelOutputLimitKeys = Object.keys(value).filter((key) =>
    isOutputLimitFieldKey(key),
  );
  if (!Object.hasOwn(value, canonicalOutputLimitKey)) {
    if (topLevelOutputLimitKeys.length > 0 || rawOutputLimitFields.keys.length > 0) {
      return { ok: false, reason: "output_limit_ambiguous" };
    }
    return { ok: false, reason: "output_limit_missing" };
  }
  if (
    topLevelOutputLimitKeys.length !== 1 ||
    topLevelOutputLimitKeys[0] !== canonicalOutputLimitKey ||
    rawOutputLimitFields.keys.length !== 1 ||
    rawOutputLimitFields.keys[0] !== canonicalOutputLimitKey
  ) {
    return { ok: false, reason: "output_limit_ambiguous" };
  }
  const limit = value[canonicalOutputLimitKey];
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 20_000) {
    return { ok: false, reason: "output_limit_malformed" };
  }
  if (value.service_tier !== undefined && value.service_tier !== "default") {
    return { ok: false, reason: "priority_tier_denied" };
  }
  if (value.batch === true || value.metadata?.batch === true) {
    return { ok: false, reason: "batch_denied" };
  }
  for (const key of Object.keys(value)) {
    if (serverSideToolKeys.has(key)) {
      return { ok: false, reason: "server_side_tools_denied" };
    }
  }
  return { ok: true };
};

const isOutputLimitFieldKey = (key) => {
  if (outputLimitFieldKeys.has(key)) {
    return true;
  }
  const normalized = key.replace(/[^0-9A-Za-z]/g, "").toLowerCase();
  return outputLimitFieldPatterns.some((pattern) => pattern.test(normalized));
};

const collectOutputLimitPropertyNames = (rawBody) => {
  const keys = [];
  for (let index = 0; index < rawBody.length; index += 1) {
    if (rawBody[index] !== '"') {
      continue;
    }
    let token;
    try {
      token = readJsonStringToken(rawBody, index);
    } catch {
      return { ok: false, keys: [] };
    }
    const next = skipJsonWhitespace(rawBody, token.end);
    if (rawBody[next] === ":" && isOutputLimitFieldKey(token.value)) {
      keys.push(token.value);
    }
    index = token.end - 1;
  }
  return { ok: true, keys };
};

const readJsonStringToken = (rawBody, start) => {
  let value = "";
  for (let index = start + 1; index < rawBody.length; index += 1) {
    const character = rawBody[index];
    if (character === '"') {
      return { end: index + 1, value };
    }
    if (character !== "\\") {
      value += character;
      continue;
    }
    index += 1;
    if (index >= rawBody.length) {
      throw new BoundaryError("json_malformed", "unterminated string escape");
    }
    const escaped = rawBody[index];
    switch (escaped) {
      case '"':
      case "\\":
      case "/":
        value += escaped;
        break;
      case "b":
        value += "\b";
        break;
      case "f":
        value += "\f";
        break;
      case "n":
        value += "\n";
        break;
      case "r":
        value += "\r";
        break;
      case "t":
        value += "\t";
        break;
      case "u": {
        const hex = rawBody.slice(index + 1, index + 5);
        if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new BoundaryError("json_malformed", "invalid unicode escape");
        }
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
        break;
      }
      default:
        throw new BoundaryError("json_malformed", "invalid string escape");
    }
  }
  throw new BoundaryError("json_malformed", "unterminated string");
};

const skipJsonWhitespace = (rawBody, start) => {
  let index = start;
  while (
    index < rawBody.length &&
    (rawBody[index] === " " ||
      rawBody[index] === "\n" ||
      rawBody[index] === "\r" ||
      rawBody[index] === "\t")
  ) {
    index += 1;
  }
  return index;
};

const validatePolicy = (raw) => {
  if (!isRecord(raw) || raw.policyVersion !== policyVersion) {
    throw new BoundaryError("policy_invalid", "boundary policy version is invalid");
  }
  const allowed = mustRecord(raw.allowed, "allowed");
  const pricing = mustRecord(raw.pricing, "pricing");
  const upstream = mustRecord(raw.upstream, "upstream");
  const listen = mustRecord(raw.listen, "listen");
  const mode = mustString(raw.mode, "mode");
  if (mode !== "enforce" && mode !== "test") {
    throw new BoundaryError("policy_invalid", "boundary mode is invalid");
  }
  const normalized = {
    allowed: {
      apiModel: mustEqual(allowed.apiModel, apiModel, "allowed.apiModel"),
      contentType: mustEqual(allowed.contentType, allowedContentType, "allowed.contentType"),
      maxConcurrent: mustInteger(allowed.maxConcurrent, "allowed.maxConcurrent", 1, 1),
      maxOutputTokens: mustInteger(allowed.maxOutputTokens, "allowed.maxOutputTokens", 1, 20_000),
      maxRequests: mustInteger(allowed.maxRequests, "allowed.maxRequests", 1, 5),
      maxSerializedBodyBytes: mustInteger(
        allowed.maxSerializedBodyBytes,
        "allowed.maxSerializedBodyBytes",
        1,
        100_000,
      ),
      maxServerSideToolInvocations: mustInteger(
        allowed.maxServerSideToolInvocations,
        "allowed.maxServerSideToolInvocations",
        0,
        0,
      ),
      method: mustEqual(allowed.method, allowedMethod, "allowed.method"),
      openCodeModel: mustEqual(allowed.openCodeModel, openCodeModel, "allowed.openCodeModel"),
      route: mustEqual(allowed.route, allowedRoute, "allowed.route"),
    },
    listen: {
      host: mustEqual(listen.host, "127.0.0.1", "listen.host"),
      port: mustInteger(listen.port, "listen.port", 1, 65535),
    },
    logPath: mustAbsoluteString(raw.logPath, "logPath"),
    mode,
    policyVersion,
    pricing: {
      capUsd: mustFinite(pricing.capUsd, "pricing.capUsd", 0, 50),
      cachedInputUsdPerMillionTokens: mustFinite(
        pricing.cachedInputUsdPerMillionTokens,
        "pricing.cachedInputUsdPerMillionTokens",
        0,
        100,
      ),
      inputUsdPerMillionTokens: mustFinite(
        pricing.inputUsdPerMillionTokens,
        "pricing.inputUsdPerMillionTokens",
        0,
        100,
      ),
      longContextThresholdTokens: mustInteger(
        pricing.longContextThresholdTokens,
        "pricing.longContextThresholdTokens",
        1,
        500_000,
      ),
      outputUsdPerMillionTokens: mustFinite(
        pricing.outputUsdPerMillionTokens,
        "pricing.outputUsdPerMillionTokens",
        0,
        100,
      ),
      perRequestMaxUsd: mustFinite(pricing.perRequestMaxUsd, "pricing.perRequestMaxUsd", 0, 50),
      priorityMultiplier: mustFinite(pricing.priorityMultiplier, "pricing.priorityMultiplier", 1, 10),
      reviewedAt: mustString(pricing.reviewedAt, "pricing.reviewedAt"),
      validUntil: mustString(pricing.validUntil, "pricing.validUntil"),
      wholeRunMaxUsd: mustFinite(pricing.wholeRunMaxUsd, "pricing.wholeRunMaxUsd", 0, 50),
    },
    readyPath: mustAbsoluteString(raw.readyPath, "readyPath"),
    statePath: mustAbsoluteString(raw.statePath, "statePath"),
    upstream: {
      baseUrl: mustString(upstream.baseUrl, "upstream.baseUrl"),
      noRedirect: upstream.noRedirect === true,
    },
  };

  if (normalized.allowed.maxOutputTokens !== 20_000) {
    throw new BoundaryError("policy_invalid", "output limit must be exactly 20000 tokens");
  }
  if (normalized.allowed.maxRequests !== 5) {
    throw new BoundaryError("policy_invalid", "request count must be exactly 5");
  }
  if (normalized.allowed.maxSerializedBodyBytes !== 100_000) {
    throw new BoundaryError("policy_invalid", "serialized body bound must be exactly 100000 bytes");
  }
  if (!normalized.upstream.noRedirect) {
    throw new BoundaryError("policy_invalid", "upstream redirect following must be disabled");
  }
  validateUpstream(normalized.mode, normalized.upstream.baseUrl);
  validateFreshPricing(normalized.pricing);
  const computedPerRequest = roundUsd(
    (normalized.allowed.maxSerializedBodyBytes * normalized.pricing.inputUsdPerMillionTokens +
      normalized.allowed.maxOutputTokens * normalized.pricing.outputUsdPerMillionTokens) /
      1_000_000,
  );
  const computedWholeRun = roundUsd(computedPerRequest * normalized.allowed.maxRequests);
  if (
    computedPerRequest !== normalized.pricing.perRequestMaxUsd ||
    computedWholeRun !== normalized.pricing.wholeRunMaxUsd ||
    computedWholeRun > normalized.pricing.capUsd ||
    normalized.pricing.capUsd >= 50
  ) {
    throw new BoundaryError("policy_invalid", "pricing calculation does not match frozen limits");
  }
  return normalized;
};

const validateUpstream = (mode, input) => {
  const url = new URL(input);
  if (mode === "enforce") {
    if (url.href !== productionUpstream) {
      throw new BoundaryError("upstream_unapproved", "production upstream must be xAI v1");
    }
    return;
  }
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  ) {
    throw new BoundaryError("upstream_unapproved", "test upstream must be loopback HTTP");
  }
};

const validateFreshPricing = (pricing) => {
  const validUntil = Date.parse(pricing.validUntil);
  if (!Number.isFinite(validUntil) || validUntil <= Date.now()) {
    throw new BoundaryError("pricing_stale", "pricing validity window is stale or invalid");
  }
};

const readState = (policy) => {
  if (!existsSync(policy.statePath)) {
    return {
      forwardedCount: 0,
      inFlight: 0,
      poisoned: false,
      reservations: [],
      totalReservedUsd: 0,
      updatedAt: nowIso(),
      version: 1,
    };
  }
  const state = readJson(policy.statePath, "state");
  if (
    !isRecord(state) ||
    !Number.isSafeInteger(state.forwardedCount) ||
    !Number.isSafeInteger(state.inFlight) ||
    !Array.isArray(state.reservations) ||
    !Number.isFinite(state.totalReservedUsd)
  ) {
    throw new BoundaryError("state_unknown", "boundary state is missing required counters");
  }
  return state;
};

const rejectRequest = async (policy, response, status, reason, detail) => {
  writeJsonResponse(response, status, { error: "boundary_refused", reason });
  logEvent(policy, "refused", { ...detail, reason, status });
};

const withGate = async (work) => {
  const prior = gate;
  let release;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  await prior;
  try {
    return await work();
  } finally {
    release();
  }
};

const readBoundedBody = (request, maxBytes) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let tooLarge = false;
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new BoundaryError("serialized_body_too_large", "serialized body exceeds limit"));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });

const forwardHeaders = (headers, requestId) => {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "transfer-encoding"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      output.set(key, value.join(", "));
    } else if (value !== undefined) {
      output.set(key, value);
    }
  }
  output.set("x-shohin-boundary-request", requestId);
  return output;
};

const copyResponseHeaders = (headers, response) => {
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === "connection" ||
      lower === "content-length" ||
      lower === "transfer-encoding"
    ) {
      continue;
    }
    response.setHeader(key, value);
  }
};

const joinUpstream = (baseUrl) => {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}${allowedRoute.slice("/v1".length)}`;
};

const writeJsonResponse = (response, status, value) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(`${JSON.stringify(value)}\n`);
};

const extractCostInUsdTicks = (body) => {
  try {
    const parsed = JSON.parse(body.toString("utf-8"));
    const value = parsed.cost_in_usd_ticks;
    return Number.isSafeInteger(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const logEvent = (policy, event, detail) => {
  const record = {
    at: nowIso(),
    detail,
    event,
    kind: "shohin_xai_spend_boundary",
  };
  mkdirSync(path.dirname(policy.logPath), { recursive: true, mode: 0o700 });
  const line = `${JSON.stringify(record)}\n`;
  const fd = openSync(policy.logPath, "a", 0o600);
  try {
    writeFileSync(fd, line, "utf-8");
  } finally {
    closeSync(fd);
  }
};

const atomicWriteJson = (filePath, value) => {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, filePath);
};

const readJson = (filePath, label) => {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    throw new BoundaryError(
      `${label}_unreadable`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const nowIso = () => new Date().toISOString();
const roundUsd = (value) => Math.round(value * 1_000_000) / 1_000_000;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const mustRecord = (value, label) => {
  if (!isRecord(value)) {
    throw new BoundaryError("policy_invalid", `${label} must be an object`);
  }
  return value;
};
const mustString = (value, label) => {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new BoundaryError("policy_invalid", `${label} must be a string`);
  }
  return value;
};
const mustAbsoluteString = (value, label) => {
  const result = mustString(value, label);
  if (!path.isAbsolute(result) || path.resolve(result) !== result) {
    throw new BoundaryError("policy_invalid", `${label} must be absolute and normalized`);
  }
  return result;
};
const mustEqual = (value, expected, label) => {
  if (value !== expected) {
    throw new BoundaryError("policy_invalid", `${label} must be ${expected}`);
  }
  return value;
};
const mustInteger = (value, label, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new BoundaryError("policy_invalid", `${label} must be an integer in range`);
  }
  return value;
};
const mustFinite = (value, label, min, max) => {
  if (!Number.isFinite(value) || value < min || value >= max) {
    throw new BoundaryError("policy_invalid", `${label} must be finite in range`);
  }
  return value;
};

class BoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

process.on("SIGTERM", () => {
  server?.close(() => process.exit(143));
  setTimeout(() => process.exit(143), 500).unref();
});
process.on("SIGINT", () => {
  server?.close(() => process.exit(130));
  setTimeout(() => process.exit(130), 500).unref();
});

main().catch((error) => {
  const code = error instanceof BoundaryError ? error.code : "startup_failed";
  try {
    const raw = existsSync(policyPath) ? readJson(policyPath, "policy") : undefined;
    if (isRecord(raw) && typeof raw.logPath === "string") {
      logEvent(
        {
          logPath: raw.logPath,
        },
        "startup_refused",
        { reason: code },
      );
    }
  } catch {
    // Startup failures must not leak policy or environment values.
  }
  console.error(`xai-spend-boundary: ${code}`);
  try {
    if (isRecord(server?.address())) {
      server?.close();
    }
  } finally {
    process.exit(2);
  }
});
