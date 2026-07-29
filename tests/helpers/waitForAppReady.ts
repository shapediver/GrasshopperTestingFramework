import {Page} from "@playwright/test";

/**
 * Waits until the AppBuilder page is usable.
 *
 * Detection strategy depends on the app variant:
 * - For standard App Builder URLs: waits for Mantine loader, then checks
 *   window.SDV.viewports to settle out of busy mode (standard viewer API).
 * - For ijewel3d URLs (containing "/ijewel3d/"): waits for Mantine loader,
 *   canvas initialization, then waits for the webGi LoadingScreenPlugin overlay
 *   to disappear.
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

  if (isIjewel3d) {
    // Step 2 (ijewel3d): Unlike the standard viewer, webGi does not expose
    // SDV viewport busy state, so ensure its canvas has been initialized.
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector("canvas");
        if (!canvas) return false;
        const rect = canvas.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      },
      undefined,
      {timeout, polling: 2_000},
    );

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
      undefined,
      {timeout, polling: 100},
    );

    // Do not sample the canvas with locator.screenshot() here. WebGi can keep
    // rendering a heavy scene continuously, so Playwright's element-stability
    // check may never complete even though the app is ready for interaction.
  } else {
    // Step 2 (standard): Wait until window.SDV is available, at least one
    // viewport exists, and all viewports have been continuously not-busy for
    // 500 ms. The debounce catches models that briefly exit busy mode between
    // render passes. This is also valid for models with no geometry, whose
    // canvas may intentionally remain hidden once computation has finished.
    await page.waitForFunction(
      () => {
        const sdv = (window as any).SDV;
        if (!sdv?.viewports) return false;
        const viewports = Object.values(sdv.viewports) as Array<{
          busy?: boolean;
          isBusy?: boolean;
        }>;
        if (viewports.length === 0) return false;

        if (
          !viewports.every(
            (viewport) => viewport.busy !== true && viewport.isBusy !== true,
          )
        ) {
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
      undefined,
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
