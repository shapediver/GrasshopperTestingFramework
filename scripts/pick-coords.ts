/**
 * Coordinate picker for the 3D viewport.
 *
 * Usage:
 *   pnpm pick-coords <scenario-id>
 *   APPBUILDER_VERSION=development pnpm pick-coords beta-cameraaction
 *
 * Opens the page, lets you click the 3D scene, and prints normalized
 * coordinates you can paste straight into scenarioActions.ts.
 */

import {chromium} from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const SCENARIO_PATH = path.resolve("tests/config/scenarios.json");
const DEFAULT_HOST = "https://appbuilder.shapediver.com/v1/main";
const DEFAULT_VERSION = "latest";

function resolveUrl(scenarioId: string): string | null {
	const raw = JSON.parse(fs.readFileSync(SCENARIO_PATH, "utf8"));
	const defaults = raw.defaults ?? {};

	const entry = raw.scenarios.find((s: Record<string, unknown>) => s.id === scenarioId);
	if (!entry) return null;

	// Merge defaults.params + scenario.params (scenario wins)
	const mergedParams: Record<string, unknown> = {...(defaults.params ?? {}), ...(entry.params ?? {})};

	// Build URL
	const envVersion = process.env.APPBUILDER_VERSION?.trim();
	const envBaseUrl = process.env.APPBUILDER_BASE_URL?.trim();
	const version = envVersion || DEFAULT_VERSION;

	const baseUrl = (entry.customUrl as string | undefined) || envBaseUrl || `${DEFAULT_HOST}/${version}/`;
	const url = new URL(baseUrl);

	if (!url.searchParams.has("slug")) {
		url.searchParams.set("slug", entry.slug as string);
	}

	for (const [key, value] of Object.entries(mergedParams)) {
		// If the param is an array, use the first value for picking
		const v = Array.isArray(value) ? value[0] : value;
		url.searchParams.set(key, String(v));
	}

	return url.toString();
}

async function main() {
	const scenarioId = process.argv[2];

	if (!scenarioId) {
		console.error("");
		console.error("  Usage: pnpm pick-coords <scenario-id>");
		console.error("  Example: pnpm pick-coords beta-cameraaction");
		console.error("  Example: APPBUILDER_VERSION=development pnpm pick-coords my-scenario");
		console.error("");
		process.exit(1);
	}

	const url = resolveUrl(scenarioId);

	if (!url) {
		console.error("");
		console.error(`  Scenario "${scenarioId}" not found in tests/config/scenarios.json`);
		console.error("  Check that the id matches one of your scenarios.");
		console.error("");
		process.exit(1);
	}

	console.log(`\n  Opening: ${url}\n`);
	console.log("  Click anywhere on the 3D viewport.");
	console.log("  Normalized coordinates appear here — copy them into your test.");
	console.log("  Close the browser window when you are done.\n");

	const browser = await chromium.launch({headless: false});
	const page = await browser.newPage({viewport: {width: 1280, height: 800}});

	// Bridge: browser click → Node.js console
	await page.exposeFunction("__pickCoord", (normX: number, normY: number) => {
		const line = `viewportCoords(page, ${normX.toFixed(3)}, ${normY.toFixed(3)})`;
		console.log(`  ${line}`);
	});

	await page.goto(url, {waitUntil: "domcontentloaded"});

	// Wait for canvas
	await page.waitForSelector("canvas", {timeout: 90_000});

	// Wait for Mantine loader to disappear (AppBuilder specific)
	try {
		await page
			.locator('[data-component="Loader"]')
			.waitFor({state: "hidden", timeout: 60_000});
	} catch {
		// Page may not use Mantine — proceed anyway
	}

	// Wait for canvas to have non-zero dimensions
	await page.waitForFunction(
		() => {
			const c = document.querySelector("canvas");
			if (!c) return false;
			const r = c.getBoundingClientRect();
			return r.width > 0 && r.height > 0;
		},
		{timeout: 60_000, polling: 1000},
	);

	// Inject click listener and overlay
	await page.evaluate(() => {
		const canvas = document.querySelector("canvas");
		if (!canvas) return;

		canvas.style.cursor = "crosshair";

		canvas.addEventListener("click", (event) => {
			const rect = canvas!.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const normX = x / rect.width;
			const normY = y / rect.height;

			(window as any).__pickCoord(normX, normY);
		});

		const info = document.createElement("div");
		info.id = "coord-picker-info";
		info.style.cssText =
			"position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,0.7);color:#fff;padding:6px 10px;border-radius:4px;font:14px monospace;pointer-events:none;z-index:9999";
		info.textContent = "Click the 3D scene → coordinates appear in terminal";
		document.body.appendChild(info);
	});

	// Keep open until user closes the browser
	await page.waitForEvent("close");
	await browser.close();

	console.log("\n  Done.\n");
}

main().catch((err) => {
	console.error("  Error:", err);
	process.exit(1);
});
