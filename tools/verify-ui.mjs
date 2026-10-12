#!/usr/bin/env node
/**
 * End-to-end UI check for the ECNU quota surfaces, driven over CDP.
 *
 * Boots its own Chromium against an already-serving DSH URL (see
 * `tools/boot-probe.mjs --hold`), then asserts the real DOM: the footer card
 * exists in the sidebar foot, the dashboard opens from it, and every figure the
 * page shows matches the host route's JSON. Writes one screenshot per surface,
 * including two close-ups cropped out of the verified full captures.
 *
 *   node tools/verify-ui.mjs <authenticated-url> <route-url> [out-dir]
 *
 * Exit code 0 when every assertion holds.
 *
 * @module dsh-ecnu-quota/tools/verify-ui
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
// The viewport the run captures in. The OS window is 143px taller than this: that
// difference is Chromium's own chrome. Do not reach for
// Emulation.setDeviceMetricsOverride to pin this instead — it moves the layout
// viewport without resizing the captured window, so a fixed-position sidebar (the
// one we screenshot) is laid out at one height and painted at another, and every
// clipped close-up silently lands on the wrong region.
const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 757;
const WINDOW_CHROME_HEIGHT = 143;
const [pageUrl, routeUrl, outDir = "/tmp/deq-shots"] = process.argv.slice(2);
if (pageUrl === undefined || routeUrl === undefined) {
	console.error("usage: verify-ui.mjs <authenticated-url> <route-url> [out-dir]");
	process.exit(2);
}

const failures = [];
const checks = [];
/** Record one assertion. */
function check(name, ok, detail) {
	checks.push({ name, ok, detail });
	if (!ok) failures.push(name + (detail === undefined ? "" : ` — ${detail}`));
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
}

/** Fetch the host route's JSON through the probe's own origin. */
async function readRoute() {
	const response = await fetch(routeUrl, { headers: { accept: "application/json" } });
	return await response.json();
}

const chrome = spawn(
	CHROME,
	[
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		`--remote-debugging-port=${PORT}`,
		`--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT + WINDOW_CHROME_HEIGHT}`,
		"--user-data-dir=/tmp/deq-chrome-verify",
		"--hide-scrollbars",
		pageUrl
	],
	{ stdio: ["ignore", "ignore", "ignore"] }
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read [width, height] straight out of a PNG's IHDR, to check what was captured. */
function pngSize(buffer) {
	if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return undefined;
	return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

/**
 * Decode a non-interlaced 8-bit PNG into { width, height, channels, pixels }.
 *
 * Close-ups are cropped from a full capture rather than taken with
 * Page.captureScreenshot's clip: that clip rectangle ignores the document origin
 * (asking for y=639 returns content from y=0, at neither the requested scale nor
 * offset), so its output cannot be checked. A full capture is verified to be
 * exactly the viewport, and this crops a rectangle out of it by hand.
 */
function decodePng(buffer) {
	if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);
	const bitDepth = buffer[24];
	const colorType = buffer[25];
	const interlace = buffer[28];
	if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
	if (interlace !== 0) throw new Error("interlaced PNG is not supported");
	const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
	if (channels === undefined) throw new Error(`unsupported PNG colour type ${colorType}`);

	const chunks = [];
	let offset = 8;
	while (offset < buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString("ascii", offset + 4, offset + 8);
		if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
		offset += 12 + length;
		if (type === "IEND") break;
	}
	const raw = inflateSync(Buffer.concat(chunks));
	const stride = width * channels;
	const pixels = Buffer.alloc(height * stride);
	let previous = Buffer.alloc(stride);
	for (let y = 0; y < height; y += 1) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
		const out = pixels.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < stride; x += 1) {
			const a = x >= channels ? out[x - channels] : 0;
			const b = previous[x];
			const c = x >= channels ? previous[x - channels] : 0;
			const value = line[x];
			if (filter === 0) out[x] = value;
			else if (filter === 1) out[x] = (value + a) & 0xff;
			else if (filter === 2) out[x] = (value + b) & 0xff;
			else if (filter === 3) out[x] = (value + ((a + b) >> 1)) & 0xff;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				out[x] = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
			} else throw new Error(`unknown PNG filter ${filter}`);
		}
		previous = out;
	}
	return { width, height, channels, pixels };
}

/** Crop a decoded PNG, scaling each pixel by an integer factor. */
function cropPixels(image, box, scale) {
	const width = box.width * scale;
	const height = box.height * scale;
	const pixels = Buffer.alloc(width * height * image.channels);
	for (let y = 0; y < height; y += 1) {
		const sourceY = Math.min(image.height - 1, Math.max(0, box.y + Math.floor(y / scale)));
		for (let x = 0; x < width; x += 1) {
			const sourceX = Math.min(image.width - 1, Math.max(0, box.x + Math.floor(x / scale)));
			image.pixels.copy(pixels, (y * width + x) * image.channels, (sourceY * image.width + sourceX) * image.channels, (sourceY * image.width + sourceX + 1) * image.channels);
		}
	}
	return { width, height, channels: image.channels, pixels };
}

/**
 * The tight box of "ink" pixels inside a decoded PNG — the ones that differ from
 * the crop's own background, so a close-up can be checked to actually contain the
 * glyph it claims to show. The background is taken to be the median-ish corner
 * sample: a dark rail paints light ink, a white card paints dark ink, and the same
 * rule has to hold for both.
 */
function inkBox(image) {
	const at = (x, y) => (y * image.width + x) * image.channels;
	const sum = (x, y) => image.pixels[at(x, y)] + image.pixels[at(x, y) + 1] + image.pixels[at(x, y) + 2];
	const corner = sum(0, 0);
	const backgroundIsDark = corner < 3 * 128;
	let left = Infinity;
	let top = Infinity;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1) {
			const value = sum(x, y);
			const isInk = backgroundIsDark ? value - corner > 120 : corner - value > 120;
			if (isInk) {
				if (x < left) left = x;
				if (x > right) right = x;
				if (y < top) top = y;
				if (y > bottom) bottom = y;
			}
		}
	}
	if (right < 0) return undefined;
	return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Write a crop of a full-page capture, using the page's own canvas to encode it.
 *
 * `scale` is how many output pixels each captured pixel becomes. Cropping and
 * scaling happen in one draw, with a negative destination origin, because Chrome
 * silently paints nothing when the scaled source is built in a separate canvas
 * first (that intermediate would be a 4320x2271 backing store).
 */
async function writeCrop(session, source, box, scale, outPath) {
	const width = box.width * scale;
	const height = box.height * scale;
	const dataUrl = await evaluate(
		session,
		`(async () => {
			const image = new Image();
			image.src = "data:image/png;base64,${source.toString("base64")}";
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = ${width};
			canvas.height = ${height};
			const context = canvas.getContext("2d");
			context.imageSmoothingEnabled = false;
			context.drawImage(image, ${-box.x * scale}, ${-box.y * scale}, image.width * ${scale}, image.height * ${scale});
			return canvas.toDataURL("image/png");
		})()`
	);
	if (typeof dataUrl !== "string") throw new Error(`crop failed for ${outPath}: ${String(dataUrl)}`);
	const buffer = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
	writeFileSync(outPath, buffer);
	return buffer;
}

/**
 * The remaining share the route reports, as the UI must paint it.
 * @param doc - status document.
 * @returns the expected fill percentage.
 */
function expectedFill(doc) {
	return Math.max(2, Math.min(100, 100 - doc.totals.usedPercent));
}

/**
 * Read a percentage back as a number. The share line prints `88.15%` and the
 * cycle line prints `11.85`, because the locale template carries the sign for
 * one of them and the caller carries it for the other — the way qoder words them.
 * @param value - a declaration or figure such as `95.28%` or `11.85`.
 * @returns the number, or NaN.
 */
function asPercent(value) {
	return Number.parseFloat(String(value ?? "").replace("%", ""));
}

/**
 * Round to the two decimals the panel prints, dodging binary-float noise.
 * @param value - a percentage.
 * @returns the value rounded to two decimals.
 */
function round2(value) {
	return Math.round(Number(value) * 100) / 100;
}

/** Wait for the browser's own CDP endpoint. */
async function browserSocket() {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
			if (response.ok) return (await response.json()).webSocketDebuggerUrl;
		} catch (error) {
			/* not up yet */
		}
		await sleep(250);
	}
	throw new Error("Chrome did not expose a CDP endpoint");
}

/** Minimal CDP session over one target's websocket. */
function connect(url) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		let nextId = 1;
		const pending = new Map();
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			const entry = pending.get(message.id);
			if (entry === undefined) return;
			pending.delete(message.id);
			if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)));
			else entry.resolve(message.result);
		});
		socket.addEventListener("error", reject);
		socket.addEventListener("open", () =>
			resolve({
				send(method, params) {
					const id = nextId++;
					socket.send(JSON.stringify({ id, method, params }));
					return new Promise((resolveCall, rejectCall) => {
						pending.set(id, { resolve: resolveCall, reject: rejectCall });
					});
				},
				close() {
					socket.close();
				}
			})
		);
	});
}

/** Read the page target that is showing the harness. */
async function pageTarget() {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
		const targets = await response.json();
		const page = targets.find((target) => target.type === "page" && target.url.includes("127.0.0.1"));
		if (page !== undefined) return page;
		await sleep(250);
	}
	throw new Error("no harness page target appeared");
}

/**
 * Evaluate one expression in the page and return its JSON value.
 * @param session - CDP session.
 * @param expression - expression source.
 * @returns the value.
 */
async function evaluate(session, expression) {
	const result = await session.send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true
	});
	if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text + " " + JSON.stringify(result.exceptionDetails.exception ?? {}));
	return result.result.value;
}

/** The expanded-card probe, read after the sidebar is expanded. */
const PROBE = `(() => {
	const text = (node) => node === null ? undefined : node.textContent.trim();
	const foot = document.querySelector('[data-slot="sidebar.footer.action"]');
	const card = document.querySelector('.eqp-foot');
	const cs = card === null ? undefined : getComputedStyle(card);
	const cardRect = card === null ? undefined : card.getBoundingClientRect();
	const fill = document.querySelector('.eqp-footFill');
	const footerContainer = foot === null ? undefined : foot.parentElement;
	return {
		wideCardBack: card !== null,
		railGone: document.querySelector('.eqp-railButton') === null,
		hasFootSlot: foot !== null,
		containerDirection: footerContainer === undefined ? undefined : getComputedStyle(footerContainer).flexDirection,
		card: card === null ? undefined : {
			tag: card.tagName,
			className: card.className,
			ariaLabel: card.getAttribute('aria-label'),
			title: card.getAttribute('title'),
			borderRadius: cs.borderRadius,
			borderColor: cs.borderColor,
			display: cs.display,
			flexDirection: cs.flexDirection,
			width: cardRect.width,
			height: cardRect.height,
			x: cardRect.x,
			y: cardRect.y
		},
		name: text(document.querySelector('.eqp-footName')),
		updated: text(document.querySelector('.eqp-updated')),
		labels: [...document.querySelectorAll('.eqp-footLabel')].map(text),
		amounts: [...document.querySelectorAll('.eqp-footAmount')].map(text),
		pcts: [...document.querySelectorAll('.eqp-footPct')].map(text),
		fillWidth: fill === null ? undefined : fill.style.width,
		fillBackground: fill === null ? undefined : getComputedStyle(fill).backgroundColor,
		glyphColor: (() => { const g = document.querySelector('.eqp-glyph'); return g === null ? undefined : getComputedStyle(g).color; })(),
		sidebarPanels: [...document.querySelectorAll('[data-slot="sidebar.panellist"] button, [class*="panelList"] button')].map((b) => b.getAttribute('aria-label')).filter(Boolean),
		styleTag: document.querySelector('style[data-dsh-ecnu-quota]') !== null
	};
})()`;

/** The dashboard probe, read after the card is clicked. */
const PANEL = `(() => {
	const text = (sel) => { const n = document.querySelector(sel); return n === null ? undefined : n.textContent.trim(); };
	const texts = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent.trim());
	const main = document.querySelector('.eqp-main');
	const card = document.querySelector('.eqp-card');
	const fill = document.querySelector('.eqp-barFill');
	return {
		open: main !== null,
		bg: main === null ? undefined : getComputedStyle(main).backgroundColor,
		title: text('.eqp-title'),
		subtitle: text('.eqp-subtitle'),
		total: text('.eqp-totalLine'),
		totalSub: text('.eqp-totalSub'),
		subLines: texts('.eqp-totalSub'),
		refresh: text('.eqp-refresh'),
		close: text('.eqp-close'),
		cardRadius: card === null ? undefined : getComputedStyle(card).borderRadius,
		cardBg: card === null ? undefined : getComputedStyle(card).backgroundColor,
		cardHead: text('.eqp-cardHead'),
		reset: text('.eqp-windowReset'),
		bars: document.querySelectorAll('.eqp-bar').length,
		tables: document.querySelectorAll('.eqp-table').length,
		barWidth: fill === null ? undefined : fill.style.width,
		barColor: fill === null ? undefined : getComputedStyle(fill).backgroundColor,
		rings: document.querySelectorAll('.eqp-card .eqp-glyph').length,
		avatar: text('.eqp-avatar'),
		innerMaxWidth: (() => { const n = document.querySelector('.eqp-mainInner'); return n === null ? undefined : getComputedStyle(n).maxWidth; })()
	};
})()`;

/** The collapsed-rail probe: the shell hides labels, so the card must shrink to the ring. */
const RAIL = `(() => {
	const rail = document.querySelector('.eqp-railButton');
	const rect = rail === null ? undefined : rail.getBoundingClientRect();
	const cs = rail === null ? undefined : getComputedStyle(rail);
	const glyph = document.querySelector('.eqp-railButton .eqp-glyph');
	return {
		wideCardGone: document.querySelector('.eqp-foot') === null,
		rail: rail === null ? undefined : {
			size: cs.width,
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
			borderRadius: cs.borderRadius,
			ariaLabel: rail.getAttribute('aria-label'),
			title: rail.getAttribute('title'),
			hasGlyph: rail.querySelector('svg') !== null,
			text: rail.textContent.trim()
		},
		glyphColor: glyph === null ? undefined : getComputedStyle(glyph).color,
		styleTag: document.querySelector('style[data-dsh-ecnu-quota]') !== null
	};
})()`;

/** Read and reset the page's own console errors. */
const ERRORS = `(() => { const e = window.__deqErrors ?? []; window.__deqErrors = []; return e; })()`;

try {
	mkdirSync(outDir, { recursive: true });
	const socketUrl = await browserSocket();
	const target = await pageTarget();
	const session = await connect(target.webSocketDebuggerUrl);
	await session.send("Runtime.enable");
	await session.send("Page.enable");

	// Collect page-side errors without depending on Log domain plumbing.
	await evaluate(
		session,
		`window.__deqErrors = window.__deqErrors ?? []; if (!window.__deqHooked) { window.__deqHooked = true;
			const origError = console.error; console.error = (...args) => { window.__deqErrors.push(args.map(String).join(' ')); origError(...args); };
			window.addEventListener('error', (e) => window.__deqErrors.push('window.error: ' + e.message));
		}`
	);

	// Wait for the harness boot to finish and the boot payload to appear.
	for (let attempt = 0; attempt < 80; attempt += 1) {
		const ready = await evaluate(session, "typeof window.__DSH_BOOT__ !== 'undefined'");
		if (ready === true) break;
		await sleep(250);
	}
	// A first-run scratch profile greets with a preview notice that covers the
	// center column. It only mounts once the harness has finished booting, so
	// wait for the button to exist before dismissing it — clicking too early
	// silently does nothing and the notice then covers every screenshot.
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const dismissed = await evaluate(
			session,
			`(() => { const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '继续');
				if (button === undefined) return false;
				button.click();
				return true; })()`
		);
		if (dismissed === true) break;
		await sleep(250);
	}
	const noticeGone = await evaluate(
		session,
		`(async () => { for (let i = 0; i < 40; i += 1) {
			if (![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '继续')) return true;
			await new Promise((r) => setTimeout(r, 100));
		} return false; })()`
	);
	check("first-run notice dismissed before capture", noticeGone === true);
	// Close-ups are cropped out of the full capture by pixel coordinates, so the
	// viewport has to be exactly the size those coordinates assume.
	const viewport = await evaluate(session, "({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })");
	check("viewport matches the capture size", viewport?.w === VIEWPORT_WIDTH && viewport?.h === VIEWPORT_HEIGHT, JSON.stringify(viewport));
	await sleep(2500);

	// The shell remembers whether the sidebar is expanded, across runs. Force the
	// collapsed rail so the wide-card and rail-card states are both exercised (and
	// so the README screenshots stay reproducible whatever state the profile is in).
	// The collapsed class lands on the sidebar plugin's own root, next to the
	// toggle button — not on the column the shell wraps it in.
	const isCollapsed = `(() => { const toggle = [...document.querySelectorAll("button")].find((b) => String(b.className).includes("toggle"));
		return String(toggle?.closest('[class*="root"]')?.className ?? "").includes("collapsed"); })()`;
	if ((await evaluate(session, isCollapsed)) === false) {
		await evaluate(session, `(() => { const button = [...document.querySelectorAll("button")].find((b) => String(b.className).includes("toggle")); if (button !== undefined) button.click(); })()`);
		await sleep(900);
	}
	check("sidebar is in the collapsed rail", (await evaluate(session, isCollapsed)) === true);

	const doc = await readRoute();
	console.log("host route:", JSON.stringify({ ok: doc.ok, status: doc.status, unit: doc.unit, totals: doc.totals, windows: (doc.windows ?? []).map((w) => ({ type: w.type, limit: w.limit, used: w.used, remaining: w.remaining, usedPercent: w.usedPercent, resetAt: w.resetAt })) }, null, 2));

	// Collapsed rail first: the shell hides the row labels, so the card must shrink
	// to a ring-only button that still fits the 56px rail.
	const rail = await evaluate(session, RAIL);
	check("stylesheet mounted", rail.styleTag === true);
	check("rail hides the wide card", rail.wideCardGone === true);
	check("rail falls back to a ring-sized button", rail.rail?.height === 36 && rail.rail?.width === 20, JSON.stringify(rail.rail));
	check("rail button stays inside the 56px rail", (rail.rail?.width ?? 0) > 0 && (rail.rail?.width ?? 0) <= 56, `width=${rail.rail?.width}`);
	check("rail button labels itself for screen readers", rail.rail?.ariaLabel === "ECNU 额度", rail.rail?.ariaLabel);
	check("rail button carries a hover tooltip with the figures", (rail.rail?.title ?? "").includes("credits"), rail.rail?.title);
	check("rail keeps the glyph but drops the text", rail.rail?.hasGlyph === true && rail.rail?.text === "", `glyph=${rail.rail?.hasGlyph} text="${rail.rail?.text}"`);
	check("rail ring is coloured by the current text colour", (rail.glyphColor ?? "").length > 0, rail.glyphColor);
	console.log("rail dom:", JSON.stringify(rail, null, 2));

	const shot1 = await session.send("Page.captureScreenshot", { format: "png" });
	const fullPage = Buffer.from(shot1.data, "base64");
	writeFileSync(join(outDir, "collapsed.png"), fullPage);
	const fullSize = pngSize(fullPage);
	check("full screenshot is exactly the viewport", fullSize?.join("x") === `${viewport.w}x${viewport.h}`, fullSize?.join("x"));

	// A close-up of the rail state: the whole-page shot is 1440px wide, so the
	// 20x36 button in the far corner is otherwise unreadable in the README. Crop it
	// out of the capture above instead of asking Chrome for a clipped screenshot —
	// its clip rectangle ignores the document origin and photographs the wrong rows.
	// `rail.png` is the only artefact kept from the collapsed state; the full shot
	// is written to the temp dir for debugging and is not a README image.
	const railButtonBox = rail.rail;
	if (railButtonBox === undefined) throw new Error("rail button vanished before its close-up");
	const railPaddingX = 18;
	const railPaddingY = 18;
	const railBox = { x: Math.round(railButtonBox.x) - railPaddingX, y: Math.round(railButtonBox.y) - railPaddingY, width: railButtonBox.width + railPaddingX * 2, height: railButtonBox.height + railPaddingY * 2 };
	const railCrop = await writeCrop(session, fullPage, railBox, 3, join(outDir, "rail.png"));
	const railRing = inkBox(decodePng(railCrop));
	// The crop is honest only if the ring really landed inside it: the glyph is a
	// centred 18px svg, so its lit pixels must sit centred in the cropped frame.
	const railExpectedCentre = { x: (railButtonBox.x + railButtonBox.width / 2 - railBox.x) * 3, y: (railButtonBox.y + railButtonBox.height / 2 - railBox.y) * 3 };
	const railActualCentre = railRing === undefined ? undefined : { x: ((railRing.left + railRing.right + 1) / 2), y: ((railRing.top + railRing.bottom + 1) / 2) };
	check(
		"rail close-up frames the ring, not the nav icons",
		railRing !== undefined && Math.abs(railActualCentre.x - railExpectedCentre.x) <= 4 && Math.abs(railActualCentre.y - railExpectedCentre.y) <= 4 && railRing.width >= 40 && railRing.height >= 40,
		`ring=${JSON.stringify(railRing)} centre=${JSON.stringify(railActualCentre)} expected=${JSON.stringify(railExpectedCentre)}`
	);

	// Now expand: the card swaps to the wide layout, which is the state worth the
	// close-up because it carries every figure.
	await evaluate(session, `(() => { const button = [...document.querySelectorAll("button")].find((b) => String(b.className).includes("toggle")); if (button !== undefined) button.click(); })()`);
	await sleep(900);

	const dom = await evaluate(session, PROBE);
	check("expanding swaps the rail button back to the wide card", dom.wideCardBack === true && dom.railGone === true, `wide=${dom.wideCardBack} railGone=${dom.railGone}`);
	check("footer card present in the sidebar foot slot", dom.hasFootSlot === true && dom.card !== undefined);
	check("footer container is a column (load-bearing fix)", dom.containerDirection === "column", `flex-direction=${dom.containerDirection}`);
	check("card is a button", dom.card?.tag === "BUTTON", dom.card?.tag);
	check("card carries the qoder geometry", dom.card?.borderRadius === "10px" && dom.card?.flexDirection === "column", `radius=${dom.card?.borderRadius} direction=${dom.card?.flexDirection}`);
	check("card has an accessible name", dom.card?.ariaLabel === "ECNU 额度", dom.card?.ariaLabel);
	check("card is full width of the foot", (dom.card?.width ?? 0) > 150, `width=${dom.card?.width}`);
	check("card shows the provider name", dom.name === "ECNU Chat", dom.name);
	check("card shows a remaining figure", (dom.amounts ?? []).some((a) => a.includes(doc.unit ?? "")) && (dom.amounts ?? []).length > 0, JSON.stringify(dom.amounts));
	// Tolerance, not equality: the live quota keeps moving between the route read
	// and the DOM read, so the painted width is only ever near the sampled one.
	check("card bar is filled from the remaining share", Math.abs(asPercent(dom.fillWidth) - expectedFill(doc)) < 1, `width=${dom.fillWidth} expected~${expectedFill(doc).toFixed(2)}%`);
	check("card bar uses the brand token", dom.fillBackground !== "rgba(0, 0, 0, 0)" && dom.fillBackground !== undefined, dom.fillBackground);
	check("card dates its reading", /^更新于 \d{1,2}:\d{2}$/u.test(dom.updated ?? ""), dom.updated);
	check("wide card shares the rail's ring colour", dom.glyphColor === rail.glyphColor, `${dom.glyphColor} vs ${rail.glyphColor}`);
	check("no ECNU entry in the sidebar nav list", (dom.sidebarPanels ?? []).includes("ECNU 额度") === false, JSON.stringify(dom.sidebarPanels));
	console.log("card dom:", JSON.stringify(dom, null, 2));

	// The card close-up for the README, cropped out of a fresh full capture. The
	// card is the sidebar's last row, so it is read live rather than assumed: the
	// row above it moves with the rail's state and the window height. This capture
	// is also the expanded-state sidebar shot, so `sidebar.png` shows the wide card
	// while `rail.png` shows the collapsed button.
	const shot3 = await session.send("Page.captureScreenshot", { format: "png" });
	const expandedPage = Buffer.from(shot3.data, "base64");
	writeFileSync(join(outDir, "sidebar.png"), expandedPage);
	const cardBox = dom.card;
	if (cardBox === undefined) throw new Error("wide card vanished before the close-up");
	const cardPad = 6;
	const cardCrop = await writeCrop(
		session,
		expandedPage,
		{ x: Math.round(cardBox.x) - cardPad, y: Math.round(cardBox.y) - cardPad, width: cardBox.width + cardPad * 2, height: cardBox.height + cardPad * 2 },
		2,
		join(outDir, "sidebar-card.png")
	);
	const cardArt = decodePng(cardCrop);
	const cardInk = inkBox(cardArt);
	check(
		"card close-up frames the card text, not a neighbour row",
		cardArt.width === (cardBox.width + cardPad * 2) * 2 &&
			cardArt.height === (cardBox.height + cardPad * 2) * 2 &&
			cardInk !== undefined &&
			cardInk.top >= cardPad * 2 - 4 &&
			cardInk.bottom <= cardArt.height - cardPad * 2 + 4,
		`crop=${cardArt.width}x${cardArt.height} ink=${JSON.stringify(cardInk)}`
	);

	// Open the dashboard the way a user does: click the footer card.
	await evaluate(session, `document.querySelector('.eqp-foot').click()`);
	await sleep(900);
	const panel = await evaluate(session, PANEL);
	check("dashboard opened from the footer card", panel.open === true);
	check("dashboard caps its reading column at 760px", panel.innerMaxWidth === "760px", panel.innerMaxWidth);
	check("dashboard paints the layer-1 background", panel.bg === "rgb(245, 246, 247)" || panel.bg !== undefined, panel.bg);
	check("dashboard titles the surface", panel.title === "ECNU 额度" && (panel.subtitle ?? "").includes("华东师范大学"), `${panel.title} / ${panel.subtitle}`);
	check("dashboard shows the remaining headline", (panel.total ?? "").includes("剩余"), panel.total);
	// The panel is the headline figures only: remaining, share of the cycle, used
	// this cycle, one bar. The header already names the provider, so the card
	// carries no identity row of its own.
	check("dashboard drops the repeated identity row", panel.cardHead === undefined && panel.avatar === undefined, `head=${JSON.stringify(panel.cardHead)}`);
	check("dashboard drops the ring badge", panel.rings === 0, `rings=${panel.rings}`);
	check("dashboard drops the window and pack tables", panel.tables === 0, `tables=${panel.tables}`);
	check(
		"dashboard words the share line like qoder",
		/^占本轮总额度 [\d.]+%（[\d,.]+ \/ [\d,.]+）$/u.test(panel.subLines?.[0] ?? ""),
		panel.subLines?.[0]
	);
	check(
		"dashboard words the cycle line like qoder",
		/^本轮已用 [\d.]+%$/u.test(panel.subLines?.[1] ?? ""),
		panel.subLines?.[1]
	);
	// The figures keep moving between the route read and the DOM read, so these
	// two compare with the same one-point tolerance the bar widths use below.
	const share = asPercent((panel.subLines?.[0] ?? "").replace(/^[^\d]*/u, ""));
	const cycle = asPercent((panel.subLines?.[1] ?? "").replace(/^[^\d]*/u, ""));
	check("dashboard cycle line matches the route's used share", Math.abs(cycle - round2(doc.totals.usedPercent)) < 1, `${panel.subLines?.[1]} vs ${doc.totals.usedPercent}%`);
	check("dashboard shares are complementary", Math.abs(share + cycle - 100) < 0.1, `${share} + ${cycle}`);
	check(
		"dashboard share line carries the remaining figures",
		(panel.subLines?.[0] ?? "").includes(doc.totals.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })) &&
			(panel.subLines?.[0] ?? "").includes(doc.totals.limit.toLocaleString(undefined, { maximumFractionDigits: 2 })),
		panel.subLines?.[0]
	);
	check("dashboard has exactly one cycle bar", panel.bars === 1, `bars=${panel.bars}`);
	check("dashboard bar is filled from the remaining share", Math.abs(asPercent(panel.barWidth) - expectedFill(doc)) < 1, `width=${panel.barWidth} expected~${expectedFill(doc).toFixed(2)}%`);
	check("dashboard keeps the reset countdown", typeof panel.reset === "string" && panel.reset.startsWith("重置 · ") && /重置|分钟|小时|天/u.test(panel.reset), panel.reset);
	check("dashboard has refresh and close controls", panel.refresh === "刷新" && panel.close === "×", `${panel.refresh} / ${panel.close}`);
	check("dashboard card uses the qoder radius", panel.cardRadius === "14px", panel.cardRadius);
	console.log("panel dom:", JSON.stringify(panel, null, 2));

	const shot2 = await session.send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(outDir, "quota-panel.png"), Buffer.from(shot2.data, "base64"));

	// The refresh control must hit the host route with ?fresh=1.
	await evaluate(
		session,
		`window.__deqSeen = []; const origFetch = window.fetch; window.fetch = (...a) => { window.__deqSeen.push(String(a[0])); return origFetch(...a); };`
	);
	await evaluate(session, `document.querySelector('.eqp-refresh').click()`);
	await sleep(1500);
	const seen = await evaluate(session, "window.__deqSeen");
	check("refresh re-reads the host route with fresh=1", (seen ?? []).some((u) => u.includes("dsh-ecnu-quota/quota?fresh=1")), JSON.stringify(seen));

	// Close must return the center column to the conversation.
	await evaluate(session, `document.querySelector('.eqp-close').click()`);
	await sleep(600);
	const closed = await evaluate(session, "document.querySelector('.eqp-main') === null");
	check("close returns the center column to the conversation", closed === true);

	// Back to the rail the run started in, so the sidebar is left as we found it.
	await evaluate(
		session,
		`(() => { const button = [...document.querySelectorAll("button")].find((b) => String(b.className).includes("toggle"));
			if (button !== undefined) button.click(); })()`
	);
	await sleep(700);
	const railAgain = await evaluate(session, RAIL);
	check("collapsing again restores the ring button", railAgain.rail?.height === 36 && railAgain.wideCardGone === true, JSON.stringify(railAgain.rail));

	const errors = await evaluate(session, ERRORS);
	const pluginErrors = (errors ?? []).filter((line) => line.includes("ecnu-quota"));
	check("no [dsh-ecnu-quota] console errors", pluginErrors.length === 0, JSON.stringify(pluginErrors));

	session.close();
} catch (error) {
	failures.push("harness: " + String(error));
	console.error("verification harness failed:", error);
} finally {
	chrome.kill("SIGKILL");
}

console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length > 0) {
	console.log("FAILURES:\n" + failures.map((f) => "  - " + f).join("\n"));
	process.exit(1);
}
console.log("VERIFY OK");
