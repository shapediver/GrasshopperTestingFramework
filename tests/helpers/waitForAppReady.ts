import {Page} from "@playwright/test";

/**
 * Waits until the AppBuilder page is usable.
 *
 * Detection strategy depends on the app variant:
 * - For standard App Builder URLs: waits for Mantine loader, visible canvas, then
 *   checks window.SDV.viewports to settle out of busy mode (standard viewer API).
 * - For ijewel3d URLs (containing "/ijewel3d/"): waits for Mantine loader, visible
 *   canvas, then waits for the webGi LoadingScreenPlugin overlay to disappear.
 */
export async function waitForAppReady(
  page: Page,
  options: {
    timeout?: number;
    interstitial?: (page: Page) => Promise<void>;
  } = {},
): Promise<void> {
  const {timeout = 90_000, interstitial} = options;
  const currentUrl = page.url();
  const isIjewel3d = /\/ijewel3d\//.test(currentUrl);

  // Step 1: React-level loader gone — Mantine Loader renders with data-component="Loader"
  await page
    .locator('[data-component="Loader"]')
    .waitFor({state: "hidden", timeout});

  if (interstitial) await interstitial(page);

  // Step 2: Canvas element must be visible and have non-zero dimensions
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
    {timeout: 60_000, polling: 2_000},
  );

  if (isIjewel3d) {
    // Step 3 (ijewel3d): The ijewel3d app uses webGi for rendering instead of
    // the standard ShapeDiver viewport. The webGi LoadingScreenPlugin creates a
    // loading overlay (#assetManagerLoadingScreen) when computing geometry and
    // hides it when done. Wait for that overlay to disappear from the DOM.
    await page.waitForFunction(
      () => {
        const loadingScreen = document.querySelector("#assetManagerLoadingScreen");
        // The element is either removed or hidden (display: none)
        if (!loadingScreen) return true;
        const style = getComputedStyle(loadingScreen);
        return style.display === "none" || style.visibility === "hidden";
      },
      {timeout, polling: 100},
    );
  } else {
    // Step 3 (standard): Wait until window.SDV is available, at least one
    // viewport exists, and all viewports have been continuously not-busy for
    // 500 ms. The debounce catches models that briefly exit busy mode between
    // render passes (e.g. an initial SESSION_CUSTOMIZED triggers a second
    // computation immediately after the first finishes).
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
}

/**
 * Checks whether the current page URL contains the ijewel3d path segment.
 */
export function isIjewel3dUrl(page: Page): boolean {
  return /\/ijewel3d\//.test(page.url());
}
