/**
 * Browser half of `dsh-ecnu-quota`.
 *
 * Hand-written `window.__ModuleLoader__.load` bundle — no build step. The file
 * is served verbatim to the page, so it stays in the plainest ES2020 the shell
 * Chromium accepts and only ever requires the platform seed words.
 *
 * Two seats, both additive:
 *   - `main`                  — the quota dashboard (keyed by PANEL_ID)
 *   - `sidebar.footer.action` — the quota card at the sidebar foot
 *
 * The card is the only entry point on purpose: no `sidebar.panellist` row, so the
 * sidebar keeps exactly one ECNU surface.
 *
 * The look is dsh-qoder-connect's, class for class: the same `dsw-alias` tokens,
 * the same footer geometry (36px rail cell, 10px card radius, hairline border
 * that only appears on hover), the same dashboard frame (760px reading column,
 * header + card + table), and the same reading of a quota bar — the track shows
 * how much is LEFT, filled with `brand-primary` and switching to
 * `state-error-primary` when that drops under the warn threshold.
 */

window.__ModuleLoader__.load({
	id: "dsh-ecnu-quota",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var react = require("react");
		var h = react.createElement;
		var useCallback = react.useCallback;
		var useEffect = react.useEffect;
		var useState = react.useState;
		var useSyncExternalStore = react.useSyncExternalStore;

		/** Cordis client-plugin name. */
		var name = "dsh-ecnu-quota-client";

		/** Services the plugin is useless without; everything else is optional. */
		var inject = ["slots", "locale"];

		/** Locale namespace this plugin owns. */
		var NS = "ecnu-quota";

		/** `main` slot key for the quota dashboard; the footer card selects it. */
		var PANEL_ID = "ecnu-quota-panel";

		/** The `conversation` key is the fallback target when closing the panel. */
		var CONVERSATION_PANEL_ID = "conversation";

		/** Host route registered by this package's Node half. */
		var ROUTE = "/plugins/dsh-ecnu-quota/quota";

		/** Background refresh cadence, in milliseconds. */
		var POLL_MS = 300_000;

		/** A snapshot younger than this is reused instead of re-fetched on mount. */
		var STALE_MS = 60_000;

		/** Remaining share below which a bar and its figures switch to the error tone. */
		var WARN_PERCENT = 20;

		/** Bar floor, so a nearly spent quota still paints a sliver instead of nothing. */
		var MIN_BAR_PERCENT = 2;

		var zh = {
			panel: "ECNU 额度",
			cardName: "ECNU Chat",
			title: "ECNU 额度",
			subtitle: "华东师范大学 Open API",
			loading: "读取中…",
			cardUpdated: "更新于",
			cardUsed: "已用",
			cardExpires: "重置",
			cardError: "额度不可用",
			quotaDashboardTitle: "ECNU 额度",
			quotaDashboardSubtitle: "华东师范大学 Open API · 每周额度窗口",
			quotaRefresh: "刷新",
			quotaRefreshing: "刷新中…",
			quotaClose: "关闭额度面板",
			quotaUpdated: "更新于 {time}",
			quotaTotalRemain: "剩余",
			quotaTotalShare: "占本轮总额度 {percent}（{remain} / {size}）",
			quotaCycleUsed: "本轮已用 {percent}%",
			quotaNoWindow: "该密钥暂无可用的额度窗口。",
			quotaCredits: "credits",
			quotaKeyTail: "尾号 {tail}",
			quotaKeySource: "密钥来源 {source}",
			quotaConsole: "用量控制台",
			quotaAutoRefresh: "每 5 分钟自动刷新",
			quotaCached: "缓存",
			quotaWeekly: "每周额度",
			quotaDaily: "每日额度",
			quotaMonthly: "每月额度",
			quotaWindow: "额度窗口",
			quotaNotConfigured: "未配置 ECNU 密钥",
			quotaUnauthorized: "密钥被拒绝",
			quotaRateLimited: "请求过于频繁",
			quotaNetwork: "网络不可用",
			quotaTimeout: "请求超时",
			quotaUpstream: "上游服务异常",
			quotaParse: "响应无法解析",
			quotaCredential: "读取密钥失败",
			quotaError: "读取失败",
			resetPending: "即将重置",
			resetsInDays: "{days} 天后重置",
			resetsInHours: "{hours} 小时后重置",
			resetsInMinutes: "{minutes} 分钟后重置"
		};

		var en = {
			panel: "ECNU quota",
			cardName: "ECNU Chat",
			title: "ECNU quota",
			subtitle: "East China Normal University Open API",
			loading: "Loading…",
			cardUpdated: "Updated",
			cardUsed: "Used",
			cardExpires: "Resets",
			cardError: "Quota unavailable",
			quotaDashboardTitle: "ECNU quota",
			quotaDashboardSubtitle: "East China Normal University Open API · weekly quota window",
			quotaRefresh: "Refresh",
			quotaRefreshing: "Refreshing…",
			quotaClose: "Close the quota panel",
			quotaUpdated: "Updated {time}",
			quotaTotalRemain: "Remaining",
			quotaTotalShare: "{percent} of this cycle’s granted total ({remain} / {size})",
			quotaCycleUsed: "Used this cycle: {percent}%",
			quotaNoWindow: "This key currently reports no quota window.",
			quotaCredits: "credits",
			quotaKeyTail: "key …{tail}",
			quotaKeySource: "key from {source}",
			quotaConsole: "Usage console",
			quotaAutoRefresh: "Refreshes every 5 minutes",
			quotaCached: "cached",
			quotaWeekly: "Weekly quota",
			quotaDaily: "Daily quota",
			quotaMonthly: "Monthly quota",
			quotaWindow: "Quota window",
			quotaNotConfigured: "No ECNU API key configured",
			quotaUnauthorized: "The API key was rejected",
			quotaRateLimited: "Too many requests",
			quotaNetwork: "Network unreachable",
			quotaTimeout: "The request timed out",
			quotaUpstream: "Upstream service error",
			quotaParse: "The response could not be parsed",
			quotaCredential: "The credential could not be read",
			quotaError: "Could not read the quota",
			resetPending: "resetting now",
			resetsInDays: "resets in {days}d {hours}h",
			resetsInHours: "resets in {hours}h {minutes}m",
			resetsInMinutes: "resets in {minutes}m"
		};

		/** Upstream failure kinds mapped to dictionary keys. */
		var ERROR_KEYS = {
			"missing-credential": "quotaNotConfigured",
			unauthorized: "quotaUnauthorized",
			"rate-limited": "quotaRateLimited",
			network: "quotaNetwork",
			timeout: "quotaTimeout",
			upstream: "quotaUpstream",
			parse: "quotaParse",
			credential: "quotaCredential"
		};

		/**
		 * Stylesheet for both surfaces: a direct translation of dsh-qoder-connect's
		 * quota stylesheet, sharing its design system down to the token names. The
		 * layout declarations (`display:flex`, `flex-direction:column`) are the
		 * hand-written styling the reference uses as well — no CSS-module build step
		 * exists in this package. `eqp-` is this plugin's prefix, so the two quota
		 * plugins never share a class name.
		 */
		var CSS = `
/* ------------------------------------------------- sidebar footer card */
/* The shell's foot area renders this list ABOVE the Settings seat, inside a
   container that is a flex ROW whose occupants each declare a full-width line,
   so as a row it overflows the column. Forcing the container into a column is
   the same load-bearing rule dsh-qoder-connect ships: identical selector, so
   the two plugins stay idempotent when both are installed, and either one is
   self-sufficient when the other is not. */
[class*="_footerActions"]{flex-direction:column}
.eqp-foot{box-sizing:border-box;flex:0 0 auto;width:100%;min-width:0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;background:0 0;border:1px solid transparent;border-radius:10px;flex-direction:column;gap:6px;margin:0 0 4px;padding:8px;display:flex}
.eqp-foot:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.eqp-foot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.eqp-foot:disabled{cursor:default}
.eqp-footTop{align-items:center;gap:8px;min-width:0;display:flex}
.eqp-footName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;font-size:13px;font-weight:500;line-height:20px}
.eqp-updated{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums;white-space:nowrap}
/* One block per quota window: a head line carrying the window's own
   remain/total, then the FULL-WIDTH bar under it. Stacking the two lets the
   card show the figures — the reason this surface exists — without squeezing
   the bar into what is left beside them. The markup must stay PHRASING content
   (it renders inside the shell's own column), so these bars are spans, not
   divs, and display:block is load-bearing on both: an inline box ignores width
   and height outright, collapsing the fill to 0x0. */
.eqp-footRow{flex-direction:column;gap:4px;min-width:0;display:flex}
.eqp-footHead{align-items:baseline;gap:8px;min-width:0;display:flex}
.eqp-footLabel{flex:1;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eqp-footAmount{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
.eqp-footBar{display:block;background:var(--dsw-alias-bg-layer-2);border-radius:999px;height:5px;overflow:hidden}
.eqp-footFill{display:block;background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.eqp-footFillWarn{background:var(--dsw-alias-state-error-primary)}
.eqp-footPct{flex:none;width:34px;color:var(--dsw-alias-label-secondary);text-align:right;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}

/* The panel's entry — a rail-width glyph that is also its own way back. The
   shell centres the collapsed footer column, so width:100% shrinks to the ring
   and the button reads as one 20x36 hit target inside the 56px rail. */
.eqp-railButton{box-sizing:border-box;width:100%;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid transparent;border-radius:8px;flex:none;justify-content:center;align-items:center;margin:0 0 4px;padding:0;display:inline-flex}
.eqp-railButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.eqp-railButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.eqp-railButton:disabled{cursor:default}

/* The usage ring. Drawn entirely in currentColor, so the rail button and the
   foot card each colour it by their own tone. */
.eqp-glyph{flex:none;justify-content:center;align-items:center;display:inline-flex;position:relative;color:var(--dsw-alias-brand-primary)}
.eqp-glyphWarn{color:var(--dsw-alias-state-error-primary)}

/* ------------------------------------------------------------ dashboard */
/* The center column in the layout frame: fill it, scroll the content column,
   and cap the reading width like the harness's own panels. */
.eqp-main{background:var(--dsw-alias-bg-layer-1);width:100%;height:100%;overflow:auto;display:block}
.eqp-mainInner{max-width:760px;margin:0 auto;padding:24px 20px 40px;flex-direction:column;gap:14px;display:flex;color:var(--dsw-alias-label-primary)}
.eqp-header{align-items:center;gap:10px;display:flex;flex-wrap:wrap}
.eqp-headerText{flex-direction:column;gap:2px;display:flex;min-width:0}
.eqp-title{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.eqp-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.eqp-spacer{flex:1}
.eqp-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;font-variant-numeric:tabular-nums}
.eqp-link{color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;text-decoration:none}
.eqp-link:hover{text-decoration:underline}
/* The dashboard's exit: an icon-sized glyph button. */
.eqp-close{min-width:28px;justify-content:center;padding-left:0;padding-right:0;box-sizing:border-box;align-items:center;cursor:pointer;font:inherit;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;height:28px;display:inline-flex}
.eqp-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.eqp-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.eqp-close span{font-size:16px;line-height:1}
.eqp-refresh{box-sizing:border-box;align-items:center;cursor:pointer;font:inherit;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 12px;display:inline-flex;gap:6px;font-size:12px;line-height:18px}
.eqp-refresh:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.eqp-refresh:disabled{opacity:.5;cursor:default}
.eqp-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* Notices: the states that carry no figures. */
.eqp-notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:12px 14px;flex-direction:column;gap:4px;display:flex}
.eqp-noticeError{border-color:var(--dsw-alias-state-error-primary)}
.eqp-noticeTitle{margin:0;font-size:13px;font-weight:600;line-height:1.5}
.eqp-noticeHint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;word-break:break-word}

/* One card for the account. The panel header already names the provider, so the
   card goes straight to the figures. */
.eqp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;padding:16px 18px;flex-direction:column;gap:16px;display:flex}

/* The two sub-lines and the cycle track. */
.eqp-bar{overflow:hidden;background:var(--dsw-alias-bg-layer-1);border-radius:999px;height:8px}
.eqp-barFill{background:var(--dsw-alias-brand-primary);border-radius:999px;height:100%;transition:width .3s ease}
.eqp-barFillWarn{background:var(--dsw-alias-state-error-primary)}
.eqp-windowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:1.5}

/* The headline figures. */
.eqp-totalLine{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.eqp-totalValue{font-size:22px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;margin-left:6px}
.eqp-totalSub{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums}

@media (prefers-reduced-motion:reduce){.eqp-footFill,.eqp-barFill{transition:none}}
`;

		/**
		 * Mount the stylesheet on `document.head`, idempotently.
		 * @returns a disposer that removes it again.
		 */
		function injectStyles() {
			var existing = document.querySelector("style[data-dsh-ecnu-quota]");
			if (existing !== null) return function () {};
			var element = document.createElement("style");
			element.setAttribute("data-dsh-ecnu-quota", "");
			element.textContent = CSS;
			document.head.appendChild(element);
			return function () {
				element.remove();
			};
		}

		/**
		 * Substitute `{name}` placeholders.
		 * @param template - translated template.
		 * @param params - replacement values.
		 * @returns the filled string.
		 */
		function fill(template, params) {
			return String(template).replace(/\{(\w+)\}/gu, function (match, key) {
				return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match;
			});
		}

		/**
		 * Format an amount for display. The host has been seen to send amounts as
		 * JSON strings, so a numeric string counts as a number here.
		 * @param value - candidate number.
		 * @returns grouped digits, or an em dash when absent.
		 */
		function formatNumber(value) {
			var numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
			if (typeof numeric !== "number" || !Number.isFinite(numeric)) return "—";
			return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
		}

		/**
		 * Clamp an upstream ratio.
		 * @param value - candidate percentage.
		 * @returns 0-100, or undefined when the input is not a number.
		 */
		function clampPercent(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
			return Math.min(100, Math.max(0, value));
		}

		/**
		 * Word the time left until a reset.
		 * @param t - bound translator.
		 * @param iso - reset timestamp.
		 * @param now - current epoch milliseconds.
		 * @returns the countdown text, or undefined when unparsable.
		 */
		function resetText(t, iso, now) {
			if (typeof iso !== "string") return undefined;
			var date = new Date(iso);
			if (Number.isNaN(date.getTime())) return undefined;
			var diff = date.getTime() - now;
			if (diff <= 60_000) return t("resetPending");
			var minutes = Math.floor(diff / 60_000);
			var hours = Math.floor(minutes / 60);
			var days = Math.floor(hours / 24);
			if (days > 0) return fill(t("resetsInDays"), { days: days, hours: hours % 24 });
			if (hours > 0) return fill(t("resetsInHours"), { hours: hours, minutes: minutes % 60 });
			return fill(t("resetsInMinutes"), { minutes: minutes });
		}

		/**
		 * Word a share for the dashboard's copy. dsh-qoder-connect prints two
		 * decimals there, so the panel does too.
		 * @param percent - share in percent, already clamped.
		 * @returns the text form, with `%`.
		 */
		function percentText(percent) {
			return Math.round(percent * 100) / 100 + "%";
		}

		/**
		 * Whether a remaining share reads as nearly spent.
		 * @param percent - remaining percentage, when known.
		 * @returns true when the bar should take the error tone.
		 */
		function isLow(percent) {
			return percent !== undefined && percent < WARN_PERCENT;
		}

		/**
		 * Word one window type.
		 * @param t - bound translator.
		 * @param type - upstream window type such as `fixed_168h`.
		 * @returns a friendly label.
		 */
		function windowLabel(t, type) {
			if (type === "fixed_168h" || type === "weekly" || type === "week") return t("quotaWeekly");
			if (type === "daily" || type === "day") return t("quotaDaily");
			if (type === "monthly" || type === "month") return t("quotaMonthly");
			return t("quotaWindow");
		}

		/**
		 * Word a card's empty state.
		 * @param t - bound translator.
		 * @param snapshot - store snapshot.
		 * @param doc - last status document, when the route answered.
		 * @returns the state text.
		 */
		function stateLabel(t, snapshot, doc) {
			if (doc === undefined) return snapshot.error === undefined ? t("loading") : t("quotaError");
			return t(ERROR_KEYS[doc.kind] ?? "quotaError");
		}

		/**
		 * Re-render on a fixed cadence so countdowns stay honest.
		 * @param ms - tick period.
		 * @returns the current epoch milliseconds.
		 */
		function useTick(ms) {
			var pair = useState(function () {
				return Date.now();
			});
			var now = pair[0];
			var setNow = pair[1];
			useEffect(function () {
				var timer = setInterval(function () {
					setNow(Date.now());
				}, ms);
				return function () {
					clearInterval(timer);
				};
			}, [ms]);
			return now;
		}

		/**
		 * Build the quota store: one shared snapshot, one shared poller, no
		 * duplicate upstream calls however many surfaces are mounted.
		 * @param route - host route to poll.
		 * @returns `{ subscribe, getSnapshot, load, ensureFresh }`.
		 */
		function createQuotaStore(route) {
			var state = { doc: undefined, error: undefined, loading: false, loadedAt: 0 };
			var listeners = new Set();
			var inflight;
			var timer;
			var detachWindow;

			function notify() {
				listeners.forEach(function (listener) {
					listener();
				});
			}

			function set(patch) {
				state = Object.assign({}, state, patch);
				notify();
			}

			async function load(fresh) {
				if (inflight !== undefined) return inflight;
				set({ loading: true });
				inflight = (async function () {
					try {
						var response = await fetch(fresh === true ? route + "?fresh=1" : route, {
							headers: { accept: "application/json" },
							credentials: "same-origin"
						});
						var text = await response.text();
						var body;
						try {
							body = JSON.parse(text);
						} catch (error) {
							body = undefined;
						}
						if (body === undefined || typeof body !== "object" || body === null) {
							throw new Error(response.ok ? "ECNU quota route returned no JSON" : "ECNU quota route answered " + response.status);
						}
						if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "ECNU quota route answered " + response.status);
						set({ doc: body, error: undefined, loading: false, loadedAt: Date.now() });
					} catch (error) {
						set({ error: error instanceof Error ? error.message : String(error), loading: false, loadedAt: Date.now() });
					} finally {
						inflight = undefined;
					}
				})();
				return inflight;
			}

			function ensureFresh() {
				if (state.doc === undefined || Date.now() - state.loadedAt > STALE_MS) load(false);
			}

			function start() {
				ensureFresh();
				timer = setInterval(function () {
					load(false);
				}, POLL_MS);
				var onWake = function () {
					if (document.visibilityState === "visible") ensureFresh();
				};
				document.addEventListener("visibilitychange", onWake);
				window.addEventListener("focus", onWake);
				detachWindow = function () {
					document.removeEventListener("visibilitychange", onWake);
					window.removeEventListener("focus", onWake);
				};
			}

			function stop() {
				if (timer !== undefined) clearInterval(timer);
				timer = undefined;
				if (detachWindow !== undefined) detachWindow();
				detachWindow = undefined;
			}

			function subscribe(listener) {
				listeners.add(listener);
				if (listeners.size === 1) start();
				return function () {
					listeners.delete(listener);
					if (listeners.size === 0) stop();
				};
			}

			return {
				subscribe: subscribe,
				getSnapshot: function () {
					return state;
				},
				load: load,
				ensureFresh: ensureFresh
			};
		}

		/**
		 * Subscribe a component to the quota store.
		 * @param store - store from {@link createQuotaStore}.
		 * @returns the current snapshot.
		 */
		function useQuota(store) {
			var snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
			useEffect(function () {
				store.ensureFresh();
			}, [store]);
			return snapshot;
		}

		/**
		 * Read a document's headline figures.
		 * @param doc - status document, when the route answered.
		 * @returns `{ ok, totals, unit, remainingPercent, low }`.
		 */
		function readTotals(doc) {
			var ok = doc !== undefined && doc.ok === true;
			var totals = ok ? doc.totals ?? {} : {};
			var usedPercent = clampPercent(totals.usedPercent);
			var remainingPercent = usedPercent === undefined ? undefined : 100 - usedPercent;
			return {
				ok: ok,
				totals: totals,
				unit: doc !== undefined && typeof doc.unit === "string" ? doc.unit : undefined,
				usedPercent: usedPercent,
				remainingPercent: remainingPercent,
				low: isLow(remainingPercent)
			};
		}

		/**
		 * The quota ring: a faint track plus an arc whose sweep is what is LEFT,
		 * drawn from 12 o'clock — dsh-qoder-connect's glyph. The card and the
		 * collapsed rail both use it as the compact face of the figures.
		 * @param props - `{ percent, warn, size, stroke }`.
		 * @returns the ring element.
		 */
		function Ring(props) {
			var size = props.size;
			var stroke = props.stroke ?? 2.5;
			var radius = size / 2 - stroke;
			var circumference = 2 * Math.PI * radius;
			var percent = clampPercent(props.percent) ?? 0;
			var dashoffset = Math.round(circumference * (1 - percent / 100) * 1e3) / 1e3;
			return h(
				"span",
				{ className: props.warn === true ? "eqp-glyph eqp-glyphWarn" : "eqp-glyph", "aria-hidden": "true" },
				h(
					"svg",
					{ viewBox: "0 0 " + size + " " + size, width: size, height: size, focusable: "false" },
					h("circle", { cx: size / 2, cy: size / 2, r: radius, fill: "none", stroke: "currentColor", strokeWidth: stroke, opacity: "0.4" }),
					h("circle", {
						cx: size / 2,
						cy: size / 2,
						r: radius,
						fill: "none",
						stroke: props.warn === true ? "var(--dsw-alias-state-error-primary)" : "currentColor",
						strokeWidth: stroke,
						strokeLinecap: "round",
						strokeDasharray: String(Math.round(circumference * 1e3) / 1e3),
						strokeDashoffset: String(dashoffset),
						transform: "rotate(-90 " + size / 2 + " " + size / 2 + ")"
					})
				)
			);
		}

		/**
		 * The remaining-share bar used on the dashboard.
		 * @param props - `{ percent, warn }`.
		 * @returns the bar element.
		 */
		function Bar(props) {
			var known = clampPercent(props.percent) !== undefined;
			var percent = clampPercent(props.percent) ?? 0;
			return h(
				"div",
				{
					className: "eqp-bar",
					role: "progressbar",
					"aria-valuemin": 0,
					"aria-valuemax": 100,
					"aria-valuenow": known ? Math.round(percent) : undefined,
					"aria-valuetext": known ? undefined : "—"
				},
				h(
					"div",
					{
						className: props.warn === true ? "eqp-barFill eqp-barFillWarn" : "eqp-barFill",
						style: { width: (known ? Math.max(MIN_BAR_PERCENT, percent) : 100) + "%", opacity: known ? 1 : 0.25 }
					}
				)
			);
		}

		/**
		 * The bottom-of-sidebar quota card: the same numbers the dashboard shows,
		 * at rail width when the column is collapsed.
		 * @param props - owner props `{ wide }` plus the injected face.
		 * @returns the card element.
		 */
		function SidebarQuotaCard(props) {
			var t = props.t;
			var snapshot = useQuota(props.store);
			var doc = snapshot.doc;
			var totals = readTotals(doc);
			var unit = totals.unit ?? t("quotaCredits");
			var wide = props.wide !== false;
			var updated = snapshot.loadedAt === 0 ? undefined : new Date(snapshot.loadedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

			var windows = totals.ok && Array.isArray(doc.windows) ? doc.windows : [];
			var bars = windows.map(function (window, index) {
				var percent = clampPercent(window.usedPercent);
				var remaining = percent === undefined ? undefined : 100 - percent;
				return {
					key: (window.type ?? "window") + "-" + index,
					label: windowLabel(t, window.type),
					detail: formatNumber(window.remaining) + " / " + formatNumber(window.limit) + " " + unit,
					percent: remaining,
					low: isLow(remaining)
				};
			});

			var title = [t("panel")].concat(
				bars.map(function (bar) {
					return bar.label + " " + bar.detail + (bar.percent === undefined ? "" : " (" + Math.round(bar.percent) + "% " + t("quotaTotalRemain") + ")");
				}),
				totals.ok && totals.totals.used !== undefined ? t("cardUsed") + " " + formatNumber(totals.totals.used) + " " + unit : "",
				updated === undefined ? "" : t("cardUpdated") + " " + updated
			);
			var label = title.filter(function (part) {
				return part !== "";
			}).join(" · ");

			if (!wide) {
				return h(
					"button",
					{ type: "button", className: "eqp-railButton", title: label, "aria-label": t("panel"), onClick: props.open },
					h(Ring, { percent: totals.remainingPercent, warn: totals.low, size: 18 })
				);
			}

			var body;
			if (!totals.ok) {
				body = h("span", { className: "eqp-footRow" }, h("span", { className: "eqp-footLabel" }, stateLabel(t, snapshot, doc)));
			} else if (bars.length === 0) {
				body = h("span", { className: "eqp-footRow" }, h("span", { className: "eqp-footLabel" }, t("quotaNoWindow")));
			} else {
				body = bars.map(function (bar) {
					var known = bar.percent !== undefined;
					return h(
						"span",
						{ className: "eqp-footRow", key: bar.key },
						h(
							"span",
							{ className: "eqp-footHead" },
							h("span", { className: "eqp-footLabel", title: bar.label }, bar.label),
							h("span", { className: "eqp-footAmount" }, bar.detail),
							h("span", { className: "eqp-footPct" }, known ? Math.round(bar.percent) + "%" : "")
						),
						h(
							"span",
							{ className: "eqp-footBar" },
							h("span", {
								className: bar.low ? "eqp-footFill eqp-footFillWarn" : "eqp-footFill",
								style: { width: (known ? Math.max(MIN_BAR_PERCENT, bar.percent) : 100) + "%", opacity: known ? 1 : 0.25 }
							})
						)
					);
				});
			}

			return h(
				"button",
				{ type: "button", className: "eqp-foot", title: label, "aria-label": t("panel"), onClick: props.open },
				h(
					"span",
					{ className: "eqp-footTop" },
					h(Ring, { percent: totals.remainingPercent, warn: totals.low, size: 16 }),
					h("span", { className: "eqp-footName" }, t("cardName")),
					h("span", { style: { flex: 1 } }),
					updated === undefined ? null : h("span", { className: "eqp-updated" }, t("cardUpdated") + " " + updated)
				),
				body
			);
		}

		/**
		 * The center column: the account card — the identity row, the headline
		 * figures with the cycle bar, and where the numbers came from.
		 * @param props - standard kit plus the injected face.
		 * @returns the dashboard element.
		 */
		function QuotaPanel(props) {
			var t = props.t;
			var snapshot = useQuota(props.store);
			var doc = snapshot.doc;
			var now = useTick(60_000);
			var totals = readTotals(doc);
			var unit = totals.unit ?? t("quotaCredits");
			var windows = totals.ok && Array.isArray(doc.windows) ? doc.windows : [];
			var consoleUrl = doc !== undefined && typeof doc.consoleUrl === "string" ? doc.consoleUrl : undefined;
			var updated = snapshot.loadedAt === 0 ? undefined : new Date(snapshot.loadedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

			var refresh = useCallback(
				function () {
					props.store.load(true);
				},
				[props.store]
			);

			var meta = [];
			if (doc !== undefined && typeof doc.providerId === "string") meta.push(doc.providerId);
			if (doc !== undefined && typeof doc.keySource === "string") meta.push(fill(t("quotaKeySource"), { source: doc.keySource }));
			if (doc !== undefined && typeof doc.keyTail === "string") meta.push(fill(t("quotaKeyTail"), { tail: doc.keyTail }));
			meta.push(t("quotaAutoRefresh"));
			if (doc !== undefined && doc.cached === true) meta.push(t("quotaCached"));

			var resetLine = resetText(t, windows.length > 0 ? windows[0].resetAt : undefined, now);

			return h(
				"div",
				{ className: "eqp-main", role: "region", "aria-label": t("quotaDashboardTitle") },
				h(
					"div",
					{ className: "eqp-mainInner" },
					h(
						"header",
						{ className: "eqp-header" },
						h(
							"div",
							{ className: "eqp-headerText" },
							h("h2", { className: "eqp-title" }, t("quotaDashboardTitle")),
							h("p", { className: "eqp-subtitle" }, t("quotaDashboardSubtitle"))
						),
						h("span", { className: "eqp-spacer" }),
						consoleUrl === undefined
							? null
							: h("a", { className: "eqp-link", href: consoleUrl, target: "_blank", rel: "noreferrer noopener" }, t("quotaConsole")),
						updated === undefined ? null : h("span", { className: "eqp-meta" }, fill(t("quotaUpdated"), { time: updated })),
						h(
							"button",
							{ type: "button", className: "eqp-refresh", disabled: snapshot.loading, onClick: refresh },
							snapshot.loading ? t("quotaRefreshing") : t("quotaRefresh")
						),
						h(
							"button",
							{ type: "button", className: "eqp-close", title: t("quotaClose"), "aria-label": t("quotaClose"), onClick: props.close },
							h("span", { "aria-hidden": "true" }, "×")
						)
					),
					!totals.ok
						? h(
								"div",
								{ className: snapshot.error === undefined ? "eqp-notice" : "eqp-notice eqp-noticeError" },
								h("p", { className: "eqp-noticeTitle" }, stateLabel(t, snapshot, doc)),
								h(
									"p",
									{ className: "eqp-noticeHint" },
									snapshot.error ?? (doc !== undefined && typeof doc.message === "string" ? doc.message : "")
								)
							)
						: h(
								"section",
								{ className: "eqp-card" },
								h(
									"p",
									{ className: "eqp-totalLine" },
									t("quotaTotalRemain"),
									h("strong", { className: "eqp-totalValue" }, formatNumber(totals.totals.remaining)),
									" / ",
									formatNumber(totals.totals.limit) + " " + unit
								),
								h(
									"p",
									{ className: "eqp-totalSub" },
									fill(t("quotaTotalShare"), {
										percent: totals.remainingPercent === undefined ? "—" : percentText(totals.remainingPercent),
										remain: formatNumber(totals.totals.remaining),
										size: formatNumber(totals.totals.limit)
									})
								),
								h(
									"p",
									{ className: "eqp-totalSub" },
									fill(t("quotaCycleUsed"), {
										// Both templates carry their own `%`; we hand them a
										// bare figure. The share line above passes its `%`
										// with the argument, so the two differ in wording
										// only — see the note in the README.
										percent: totals.usedPercent === undefined ? "—" : formatNumber(totals.usedPercent)
									})
								),
								h(Bar, { percent: totals.remainingPercent, warn: totals.low }),
								resetLine === undefined ? null : h("p", { className: "eqp-windowReset" }, t("cardExpires") + " · " + resetLine),
								meta.length === 0 ? null : h("p", { className: "eqp-totalSub" }, meta.join(" · "))
							)
				)
			);
		}

		/**
		 * Mount every seat this plugin occupies. Each registration is already
		 * fiber-scoped by `ctx.slots.register`, so an unload releases the UI.
		 * @param ctx - client plugin context.
		 */
		function apply(ctx) {
			try {
				ctx.effect(function () {
					return injectStyles();
				}, "dsh-ecnu-quota: styles");
				var t = ctx.locale.bind(NS);
				ctx.effect(function () {
					return ctx.locale.register(NS, { zh: zh, en: en });
				}, "dsh-ecnu-quota: dictionaries");

				var store = createQuotaStore(ROUTE);

				/** Send the conversation back into the center column. */
				var closePanel = function () {
					var layout = ctx.get("layout");
					if (layout === undefined || typeof layout.selectPanel !== "function") return;
					try {
						layout.selectPanel(null);
					} catch (error) {
						try {
							layout.selectPanel(CONVERSATION_PANEL_ID);
						} catch (inner) {
							console.error("[dsh-ecnu-quota] could not close the quota panel:", inner);
						}
					}
				};

				/* The center panel must exist before anything dispatches its key. */
				ctx.slots.inject("main", function () {
					return ctx.slots.register(
						{
							name: "main",
							key: PANEL_ID,
							locale: NS,
							inject: function () {
								return { t: t, store: store, close: closePanel };
							}
						},
						QuotaPanel
					);
				});

				/* Sidebar foot card — the only ECNU surface in the sidebar, and the
				   only way into the dashboard above (`main` needs `layout`). */
				ctx.inject(["layout"], function (layoutCtx) {
					var layout = layoutCtx.get("layout");
					if (layout === undefined || typeof layout.selectPanel !== "function") return;
					try {
						layoutCtx.slots.inject("sidebar.footer.action", function () {
							return layoutCtx.slots.register(
								{
									name: "sidebar.footer.action",
									id: "ecnu-quota",
									order: 20,
									locale: NS,
									inject: function () {
										return {
											t: t,
											store: store,
											open: function () {
												try {
													layout.selectPanel(PANEL_ID);
												} catch (error) {
													console.error("[dsh-ecnu-quota] could not open the quota panel:", error);
												}
											}
										};
									}
								},
								SidebarQuotaCard
							);
						});
					} catch (error) {
						console.error("[dsh-ecnu-quota] could not register the sidebar quota card:", error);
					}
				});
			} catch (error) {
				console.error("[dsh-ecnu-quota] client half failed to load (host half unaffected):", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
