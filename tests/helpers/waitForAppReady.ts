import {Page} from "@playwright/test";

/**
 * Waits until the AppBuilder page is usable.
 *
 * This helper is intentionally AppBuilder / ShapeDiver specific:
 * - it waits for the Mantine loader to disappear
 * - it waits for a visible canvas
 * - it waits for window.SDV viewports to settle out of busy mode
 */
export async function waitForAppReady(
  page: Page,
  options: {
    timeout?: number;
    interstitial?: (page: Page) => Promise<void>;
  } = {},
): Promise<void> {
  const {timeout = 90_000, interstitial} = options;

  await page
    .locator('[data-component="Loader"]')
    .waitFor({state: "hidden", timeout});

  if (interstitial) await interstitial(page);

  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
    {timeout: 60_000, polling: 2_000},
  );

  await page.waitForFunction(
    () => {
      const sdv = (window as any).SDV;
      if (!sdv?.viewports) return false;
      const viewports = Object.values(sdv.viewports) as Array<{busy?: boolean}>;
      if (viewports.length === 0) return false;

      if (!viewports.every((viewport) => !viewport.busy)) {
        (window as any).__sdvBusyFreeStart = undefined;
        return false;
      }

      const now = Date.now();
      if (!(window as any).__sdvBusyFreeStart) {
        (window as any).__sdvBusyFreeStart = now;
        return false;
      }

      return now - (window as any).__sdvBusyFreeStart >= 500;
    },
    {timeout, polling: 100},
  );
}
