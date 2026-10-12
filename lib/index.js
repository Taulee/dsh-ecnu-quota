/**
 * Host half of `dsh-ecnu-quota` — read the ECNU Chat (华东师范大学) quota for the
 * API key the `ecnuchat` model provider already uses, and publish it on one
 * read-only same-origin route for the browser half to render.
 *
 * Nothing is written, nothing is spent: the route performs one authenticated
 * `GET` against the ECNU quota endpoint, normalizes the answer, and caches it
 * briefly so several readers (sidebar card, detail panel, extra tabs) do not
 * turn into a burst of upstream calls.
 *
 * @module dsh-ecnu-quota
 */

/**
 * A profile-linked plugin has no `node_modules` of its own, so importing the
 * platform's ESM packages from here would fail to resolve. The credential ref
 * brand is compile-time only (`@deepseek-ai/dsh-brand`'s `brandString` returns
 * its argument untouched), so the same value is produced locally.
 */
const KEY_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate an environment-variable name as a credential ref.
 * @param value - candidate ref name.
 * @returns the ref, as the credentials service expects it.
 */
function credentialRef(value) {
	if (typeof value !== "string" || !KEY_REF_PATTERN.test(value)) {
		throw new TypeError(`credential ref "${String(value)}" must match ${String(KEY_REF_PATTERN)}`);
	}
	return value;
}

/** Cordis plugin name. */
export const name = "dsh-ecnu-quota";

/**
 * Hard dependencies. The route is a side feature — a profile without a
 * webserver (tui, headless, CLI) must still load this plugin — so `webServer`
 * and `credentials` are acquired lazily through `ctx.inject` instead.
 */
export const inject = [];

/** Credential ref the `ecnuchat` provider resolves through `apiKeyEnv`. */
const DEFAULT_KEY_REF = "ECNUCHAT_API_KEY";

/** Quota endpoint of the ECNU Open API. */
const DEFAULT_QUOTA_URL = "https://chat.ecnu.edu.cn/open/api/v1/quota";

/** Operators' console, linked from the detail panel. */
const DEFAULT_CONSOLE_URL = "https://aiconsole.ecnu.edu.cn";

/** Same-origin route the browser half polls. */
const DEFAULT_ROUTE = "/plugins/dsh-ecnu-quota/quota";

/** How long one upstream answer serves further readers, in milliseconds. */
const CACHE_MS = 15_000;

/** Upstream request deadline, in milliseconds. */
const TIMEOUT_MS = 15_000;

/** Ceiling on an upstream body we are willing to parse, in bytes. */
const MAX_BODY_BYTES = 512 * 1024;

/** Loopback hostnames a local plugin surface may be addressed by. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Strip the optional `:port` from a Host header value, IPv6-bracket aware.
 * @param host - raw `Host` header value.
 * @returns the hostname alone, lower-cased.
 */
function hostnameOfHost(host) {
	let hostname = host.trim().toLowerCase();
	if (hostname.startsWith("[")) {
		const end = hostname.indexOf("]");
		return end === -1 ? hostname : hostname.slice(0, end + 1);
	}
	const colon = hostname.lastIndexOf(":");
	if (colon !== -1 && /^\d+$/u.test(hostname.slice(colon + 1))) hostname = hostname.slice(0, colon);
	return hostname;
}

/**
 * The request must be addressed to the loopback interface, and a
 * browser-attached Origin must be loopback too. The Host check drops
 * DNS-rebinding pages (their Host is the attacker's domain, not loopback);
 * a same-origin fetch carries no Origin and passes on Host alone.
 * @param req - incoming request.
 * @returns whether the request may read the status document.
 */
function loopbackRequest(req) {
	const host = req.headers.host;
	if (host === undefined || host.trim() === "") return false;
	if (!LOOPBACK_HOSTS.has(hostnameOfHost(host))) return false;
	const origin = req.headers.origin;
	if (origin === undefined || origin.trim() === "") return true;
	try {
		const { hostname } = new URL(origin);
		return LOOPBACK_HOSTS.has(hostname) || hostname === "::1";
	} catch {
		return false;
	}
}

/**
 * Redact token-shaped fragments before any message reaches the browser.
 * @param error - thrown value.
 * @returns a short, safe message.
 */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error))
		.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]")
		.replace(/\b(sk-|Bearer\s+)[A-Za-z0-9._-]{6,}/giu, "$1[redacted]")
		.slice(0, 500);
}

/**
 * Write one JSON answer.
 * @param res - response under construction.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store"
	});
	res.end(payload);
}

/**
 * Coerce an upstream field to a finite number.
 * @param value - candidate.
 * @returns the number, or undefined when it is not one.
 */
function numberOrUndefined(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

/**
 * Coerce an upstream field to a non-empty string.
 * @param value - candidate.
 * @returns the string, or undefined when it is not one.
 */
function stringOrUndefined(value) {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Redirect a plugin entry's config into the option record this module reads.
 * @param config - entry config from the Cordis patch.
 * @returns resolved options with defaults applied.
 */
function normalizeOptions(config) {
	// A `!!js` patch expression reaches `apply` as a getter rather than a record.
	const raw = typeof config === "function" ? config() : config;
	const source = raw !== null && typeof raw === "object" ? raw : {};
	const route = stringOrUndefined(source.route) ?? DEFAULT_ROUTE;
	return {
		keyRef: stringOrUndefined(source.apiKeyEnv) ?? DEFAULT_KEY_REF,
		quotaUrl: stringOrUndefined(source.quotaUrl) ?? DEFAULT_QUOTA_URL,
		consoleUrl: stringOrUndefined(source.consoleUrl) ?? DEFAULT_CONSOLE_URL,
		provider: stringOrUndefined(source.providerLabel) ?? "ECNU Chat",
		route: route.startsWith("/") ? route : `/${route}`,
		cacheMs: numberOrUndefined(source.cacheMs) ?? CACHE_MS,
		timeoutMs: numberOrUndefined(source.timeoutMs) ?? TIMEOUT_MS
	};
}

/**
 * Resolve the API key behind the provider's `apiKeyEnv` ref.
 *
 * The credential store already consults the launch environment, the stored
 * file, and the `.env` layers, so the ambient read afterwards only covers a
 * profile composed without the credentials service.
 *
 * @param credentials - the `credentials` service, when this profile has one.
 * @param ref - credential ref name.
 * @returns `{ value, source }`, or undefined when nothing is configured.
 */
async function resolveSecret(credentials, ref) {
	if (credentials !== undefined && typeof credentials.resolve === "function") {
		const hit = await credentials.resolve(credentialRef(ref));
		const value = hit !== undefined && typeof hit.value === "string" ? hit.value.trim() : "";
		if (value !== "") return { value, source: stringOrUndefined(hit.source) ?? "credentials" };
	}
	const ambient = process.env[ref];
	if (typeof ambient === "string" && ambient.trim() !== "") return { value: ambient.trim(), source: "environment" };
	return undefined;
}

/**
 * Normalize one quota window: percentages are derived here so the browser half
 * never has to guess whether a limit of zero means "unlimited" or "unknown".
 * @param raw - one entry of the upstream `windows` array.
 * @returns the window snapshot the client renders.
 */
function normalizeWindow(raw) {
	const limit = numberOrUndefined(raw?.limit);
	const used = numberOrUndefined(raw?.used);
	const remaining = numberOrUndefined(raw?.remaining) ?? (limit !== undefined && used !== undefined ? limit - used : undefined);
	const usedPercent = limit !== undefined && limit > 0 && used !== undefined
		? Math.round(Math.min(100, Math.max(0, (used / limit) * 100)) * 10_000) / 10_000
		: undefined;
	return {
		type: stringOrUndefined(raw?.type) ?? "window",
		...(limit === undefined ? {} : { limit }),
		...(used === undefined ? {} : { used }),
		...(remaining === undefined ? {} : { remaining }),
		...(usedPercent === undefined ? {} : { usedPercent }),
		...(stringOrUndefined(raw?.window_started_at) === undefined ? {} : { windowStartedAt: raw.window_started_at }),
		...(stringOrUndefined(raw?.reset_at) === undefined ? {} : { resetAt: raw.reset_at }),
		...(stringOrUndefined(raw?.source) === undefined ? {} : { source: raw.source })
	};
}

/**
 * Sum the windows into the one headline figure the sidebar card shows.
 * @param windows - normalized windows.
 * @returns totals, with `limit` absent when every window omitted one.
 */
function totalsOf(windows) {
	let limit;
	let used;
	let remaining;
	for (const window of windows) {
		if (window.limit !== undefined) limit = (limit ?? 0) + window.limit;
		if (window.used !== undefined) used = (used ?? 0) + window.used;
		if (window.remaining !== undefined) remaining = (remaining ?? 0) + window.remaining;
	}
	const usedPercent = limit !== undefined && limit > 0 && used !== undefined
		? Math.round(Math.min(100, Math.max(0, (used / limit) * 100)) * 10_000) / 10_000
		: undefined;
	return {
		...(limit === undefined ? {} : { limit }),
		...(used === undefined ? {} : { used }),
		...(remaining === undefined ? {} : { remaining }),
		...(usedPercent === undefined ? {} : { usedPercent })
	};
}

/**
 * Classify a failed upstream call into a slug the client words in its locale.
 * @param status - upstream HTTP status, or 0 for a transport failure.
 * @returns a stable kind string.
 */
function kindOfFailure(status) {
	if (status === 401 || status === 403) return "unauthorized";
	if (status === 429) return "rate-limited";
	if (status === 0) return "network";
	if (status >= 500) return "upstream";
	return "upstream";
}

/**
 * Read one upstream answer under a deadline and a size ceiling.
 * @param options - resolved plugin options.
 * @param apiKey - resolved secret value; never logged, never returned.
 * @returns the parsed body.
 * @throws an Error carrying a `kind` slug from {@link kindOfFailure}.
 */
async function fetchQuota(options, apiKey) {
	const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
	let response;
	try {
		response = await fetch(options.quotaUrl, {
			method: "GET",
			headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
			signal: timeoutSignal
		});
	} catch (error) {
		const failure = new Error(timeoutSignal.aborted
			? `ECNU quota request timed out after ${options.timeoutMs} ms.`
			: "ECNU quota request failed before a response arrived.");
		failure.kind = timeoutSignal.aborted ? "timeout" : "network";
		failure.cause = error;
		throw failure;
	}
	let text;
	try {
		text = await response.text();
	} catch (error) {
		const failure = new Error("ECNU quota response could not be read.");
		failure.kind = "network";
		failure.cause = error;
		throw failure;
	}
	if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
		const failure = new Error(`ECNU quota response exceeded ${MAX_BODY_BYTES} bytes.`);
		failure.kind = "upstream";
		throw failure;
	}
	if (!response.ok) {
		const failure = new Error(`ECNU quota request answered ${response.status}${text.trim() === "" ? "" : `: ${text.trim().slice(0, 200)}`}`);
		failure.kind = kindOfFailure(response.status);
		failure.status = response.status;
		throw failure;
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		const failure = new Error("ECNU quota response was not JSON.");
		failure.kind = "parse";
		failure.cause = error;
		throw failure;
	}
}

/**
 * Assemble the whole status document the browser half consumes. A failure
 * degrades in place: the document still answers 200 with `ok: false`, so the
 * card can show *why* it is empty instead of a blank panel.
 *
 * @param options - resolved plugin options.
 * @param credentials - the `credentials` service, when available.
 * @returns the status document.
 */
async function buildStatus(options, credentials) {
	const base = { ok: true, status: "ok", provider: options.provider, keyRef: options.keyRef, fetchedAt: Date.now() };
	const secret = await resolveSecret(credentials, options.keyRef);
	if (secret === undefined) {
		return {
			...base,
			ok: false,
			status: "missing-credential",
			kind: "missing-credential",
			message: `No ECNU API key is configured for ${options.keyRef}.`
		};
	}
	const identity = { keySource: secret.source, ...(secret.value.length >= 8 ? { keyTail: secret.value.slice(-4) } : {}) };
	try {
		const raw = await fetchQuota(options, secret.value);
		const windows = Array.isArray(raw?.windows) ? raw.windows.map(normalizeWindow) : [];
		return {
			...base,
			...identity,
			unit: stringOrUndefined(raw?.unit) ?? "credits",
			...(stringOrUndefined(raw?.provider_id) === undefined ? {} : { providerId: raw.provider_id }),
			...(stringOrUndefined(raw?.api_key_id) === undefined ? {} : { apiKeyId: raw.api_key_id }),
			...(stringOrUndefined(raw?.ops_console_url) === undefined ? { consoleUrl: options.consoleUrl } : { consoleUrl: raw.ops_console_url }),
			windows,
			totals: totalsOf(windows),
			resourcePacks: Array.isArray(raw?.resource_packs) ? raw.resource_packs : []
		};
	} catch (error) {
		return {
			...base,
			...identity,
			ok: false,
			status: "error",
			kind: stringOrUndefined(error?.kind) ?? "upstream",
			message: safeMessage(error)
		};
	}
}

/**
 * Build the loopback-guarded GET handler for the status route.
 * @param options - resolved plugin options.
 * @param services - `{ credentials }`, resolved lazily per request.
 * @returns an HTTP handler.
 */
function quotaHandler(options, services) {
	const cache = { at: 0, doc: undefined };
	const read = async (fresh) => {
		if (!fresh && cache.doc !== undefined && Date.now() - cache.at < options.cacheMs) {
			return { ...cache.doc, cached: true };
		}
		const doc = await buildStatus(options, services.credentials());
		cache.at = Date.now();
		cache.doc = doc;
		return doc;
	};
	return async (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			json(res, 405, { error: "method not allowed" });
			return;
		}
		if (!loopbackRequest(req)) {
			json(res, 403, { error: "request-not-trusted" });
			return;
		}
		try {
			const fresh = (req.url ?? "").includes("fresh=1");
			json(res, 200, await read(fresh));
		} catch (error) {
			json(res, 500, { error: safeMessage(error) });
		}
	};
}

/**
 * Mount the plugin: one read-only route, disposed with the plugin fiber.
 * @param ctx - plugin context.
 * @param config - entry config from the Cordis patch.
 */
export function apply(ctx, config) {
	const options = normalizeOptions(config);
	let credentials;
	ctx.inject(["credentials"], (credentialsCtx) => {
		credentials = credentialsCtx.credentials;
	});
	ctx.inject(["webServer"], (webCtx) => {
		const handler = quotaHandler(options, { credentials: () => credentials });
		ctx.effect(() => {
			const dispose = webCtx.webServer.register({ kind: "exact", path: options.route, handler });
			return () => {
				dispose();
			};
		}, "dsh-ecnu-quota: quota route");
	});
}
