import {expect, Page, test} from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Takes a full-page screenshot and compares it against the stored baseline.
 *
 * If the baseline does not exist yet, it is created automatically and the test passes.
 */
export async function takeSnapshot(
  page: Page,
  name: string,
  options: {
    maxDiffPixelRatio?: number;
  } = {},
) {
  const baselinePath = test.info().snapshotPath(`${name}.png`);
  // App Builder branding can be an animated GIF. Mask it in both baseline
  // creation and comparison so animation frames cannot cause visual diffs.
  const animatedImages = page.locator('img[src*=".gif" i]');

  if (!fs.existsSync(baselinePath)) {
    const screenshot = await page.screenshot({
      fullPage: true,
      mask: [animatedImages],
    });
    fs.mkdirSync(path.dirname(baselinePath), {recursive: true});
    fs.writeFileSync(baselinePath, screenshot);
    console.log(`[takeSnapshot] Created new baseline: ${baselinePath}`);
    return;
  }

  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    mask: [animatedImages],
    // Leave the default to playwright.config.ts. A caller can still opt in to
    // a per-snapshot threshold when a scenario genuinely needs one.
    ...(options.maxDiffPixelRatio === undefined
      ? {}
      : {maxDiffPixelRatio: options.maxDiffPixelRatio}),
  });
}
