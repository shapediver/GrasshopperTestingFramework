import {expect, Page} from "@playwright/test";
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
  const {maxDiffPixelRatio = 0.02} = options;
  const baselinePath = path.resolve(`tests/snapshots/${name}.png`);

  if (!fs.existsSync(baselinePath)) {
    const screenshot = await page.screenshot({fullPage: true});
    fs.mkdirSync(path.dirname(baselinePath), {recursive: true});
    fs.writeFileSync(baselinePath, screenshot);
    console.log(`[takeSnapshot] Created new baseline: ${baselinePath}`);
    return;
  }

  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    maxDiffPixelRatio,
  });
}
