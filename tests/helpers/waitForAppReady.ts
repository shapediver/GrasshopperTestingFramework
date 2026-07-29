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
    // Step 2 (standard): AppBuilder instance processes may start after the
    // React loader disappears. Track busy and beauty events so a later busy
    // cycle invalidates an earlier apparent ready state.
    await page.waitForFunction(
      () => !!(window as any).SDV?.viewports,
      undefined,
      {timeout, polling: 100},
    );
    await page.evaluate(() => {
      const SDV = (window as any).SDV;
      const viewports = Object.values(SDV.viewports ?? {}) as any[];
      const state = {
        startedAt: Date.now(),
        beautyRenderFinishedAt: 0,
        busyFreeSince: 0,
        lastBusyOnAt: 0,
        lastBusyOffAt: 0,
        beautyRenderToken: "",
        busyOnToken: "",
        busyOffToken: "",
      };

      if (
        viewports.some(
          (viewport) => viewport.busy === true || viewport.isBusy === true,
        )
      ) {
        state.lastBusyOnAt = Date.now();
      }

      state.beautyRenderToken = SDV.addListener(
        SDV.EVENTTYPE?.RENDERING?.BEAUTY_RENDERING_FINISHED ??
          "rendering.beautyRenderingFinished",
        () => {
          const currentViewports = Object.values(
            SDV.viewports ?? {},
          ) as any[];
          if (
            currentViewports.every(
              (viewport) =>
                viewport.busy !== true && viewport.isBusy !== true,
            )
          ) {
            state.beautyRenderFinishedAt = Date.now();
          }
        },
      );
      state.busyOnToken = SDV.addListener(
        SDV.EVENTTYPE?.VIEWPORT?.BUSY_MODE_ON ?? "viewport.busy.on",
        () => {
          state.beautyRenderFinishedAt = 0;
          state.busyFreeSince = 0;
          state.lastBusyOnAt = Date.now();
        },
      );
      state.busyOffToken = SDV.addListener(
        SDV.EVENTTYPE?.VIEWPORT?.BUSY_MODE_OFF ?? "viewport.busy.off",
        () => {
          state.busyFreeSince = 0;
          state.lastBusyOffAt = Date.now();
        },
      );

      (window as any).__sdvAppReady = state;
    });

    try {
      await page.waitForFunction(
        () => {
          const SDV = (window as any).SDV;
          const state = (window as any).__sdvAppReady;
          const viewports = Object.values(SDV?.viewports ?? {}) as any[];
          if (!state || viewports.length === 0) return false;

          const allViewportsIdle = viewports.every(
            (viewport) =>
              viewport.busy !== true && viewport.isBusy !== true,
          );
          if (!allViewportsIdle) {
            state.beautyRenderFinishedAt = 0;
            state.busyFreeSince = 0;
            state.lastBusyOnAt = Date.now();
            return false;
          }

          const now = Date.now();
          if (!state.busyFreeSince) {
            state.busyFreeSince = now;
            return false;
          }

          const lastModelEventAt = Math.max(
            state.startedAt,
            state.lastBusyOnAt,
            state.lastBusyOffAt,
          );
          if (
            state.beautyRenderFinishedAt >= lastModelEventAt &&
            now -
              Math.max(
                state.beautyRenderFinishedAt,
                state.busyFreeSince,
              ) >=
              500
          )
            return true;

          // Some viewports render continuously and never emit beauty-finished.
          return (
            now -
              Math.max(lastModelEventAt, state.busyFreeSince) >=
            2_000
          );
        },
        undefined,
        {timeout, polling: 100},
      );
    } finally {
      await page.evaluate(() => {
        const SDV = (window as any).SDV;
        const state = (window as any).__sdvAppReady;
        if (state) {
          if (state.beautyRenderToken)
            SDV.removeListener(state.beautyRenderToken);
          if (state.busyOnToken) SDV.removeListener(state.busyOnToken);
          if (state.busyOffToken)
            SDV.removeListener(state.busyOffToken);
        }
        delete (window as any).__sdvAppReady;
      });
    }
  }
}

/**
 * Checks whether the current page URL contains the ijewel3d path segment.
 */
export function isIjewel3dUrl(page: Page): boolean {
  return /\/ijewel3d\//.test(page.url());
}
