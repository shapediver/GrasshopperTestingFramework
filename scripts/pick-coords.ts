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
import {loadScenarios} from "../tests/helpers/loadScenarios";
import {resolveTargetUrl} from "../tests/helpers/resolveTargetUrl";

function resolveUrl(scenarioId: string): string {
  const {scenarios} = loadScenarios();
  const matches = scenarios.filter((scenario) => scenario.id === scenarioId);
  if (matches.length === 1) return resolveTargetUrl(matches[0]);
  if (matches.length > 1) {
    throw new Error(
      `Scenario id "${scenarioId}" matches multiple scenarios in tests/config/scenarios.json. Please temporarily make the target one unique before running pick-coords.`,
    );
  }

  throw new Error(
    `Scenario "${scenarioId}" not found in tests/config/scenarios.json`,
  );
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
