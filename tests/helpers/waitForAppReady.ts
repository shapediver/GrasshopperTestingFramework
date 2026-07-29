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

  if (!isIjewel3d) {
    // Start tracking as soon as SDV is available, before waiting for the React
    // loader. Parameter-settings URLs and model states can begin a deferred
    // customization after the loader disappears, so sampling `viewport.busy`
    // only afterwards can otherwise race that work.
    await page.waitForFunction(
      () => {
        const SDV = (window as any).SDV;
        if (!SDV?.addListener) return false;
        if ((window as any).__sdvAppReadyTracker) return true;

        const state = {
          customizationSeen: false,
          beautyAfterCustomization: false,
          busySeen: false,
          busyFinished: false,
          tokens: [] as string[],
        };
        (window as any).__sdvAppReadyTracker = state;

        state.tokens.push(
          SDV.addListener(
            SDV.EVENTTYPE?.SESSION?.SESSION_CUSTOMIZED ?? "session.customized",
            () => {
              state.customizationSeen = true;
            },
          ),
          SDV.addListener(
            SDV.EVENTTYPE?.RENDERING?.BEAUTY_RENDERING_FINISHED ??
              "rendering.beautyRenderingFinished",
            () => {
              if (state.customizationSeen)
                state.beautyAfterCustomization = true;
            },
          ),
          SDV.addListener(
            SDV.EVENTTYPE?.VIEWPORT?.BUSY_MODE_ON ?? "viewport.busy.on",
            () => {
              state.busySeen = true;
              state.busyFinished = false;
            },
          ),
          SDV.addListener(
            SDV.EVENTTYPE?.VIEWPORT?.BUSY_MODE_OFF ?? "viewport.busy.off",
            () => {
              if (state.busySeen) state.busyFinished = true;
            },
          ),
        );
        return true;
      },
      {timeout},
    );
  }

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
      {timeout, polling: 100},
    );

    // Do not sample the canvas with locator.screenshot() here. WebGi can keep
    // rendering a heavy scene continuously, so Playwright's element-stability
    // check may never complete even though the app is ready for interaction.
  } else {
    // Step 2 (standard): Wait for all viewports to be idle after the final
    // observed busy/customization cycle. Deferred model-state and parameter
    // settings requests must produce such a cycle before this can resolve.
    await page.waitForFunction(
      () => {
        const sdv = (window as any).SDV;
        const state = (window as any).__sdvAppReadyTracker;
        if (!sdv?.viewports) return false;
        const viewports = Object.values(sdv.viewports) as Array<{
          busy?: boolean;
          isBusy?: boolean;
        }>;
        if (viewports.length === 0) return false;

        if (!viewports.every((viewport) => !(viewport.busy ?? viewport.isBusy))) {
          (window as any).__sdvBusyFreeStart = undefined;
          return false;
        }

        const now = Date.now();
        if (!(window as any).__sdvBusyFreeStart) {
          (window as any).__sdvBusyFreeStart = now;
          return false;
        }

        const hasDeferredCustomization =
          new URLSearchParams(window.location.search).has("modelStateId") ||
          new URLSearchParams(window.location.search).has(
            "_parameters_settings_url",
          );
        const completedObservedCycle =
          state?.beautyAfterCustomization ||
          (state?.busySeen && state?.busyFinished);
        if (hasDeferredCustomization && !completedObservedCycle) return false;

        // A static app may not emit a customization or busy event at all.
        // Keep a longer quiet fallback for that case, while event-driven apps
        // proceed as soon as their final idle debounce has elapsed.
        const requiredIdleMs = hasDeferredCustomization
          ? 2_000
          : completedObservedCycle
            ? 500
            : 2_000;
        return now - (window as any).__sdvBusyFreeStart >= requiredIdleMs;
      },
      {timeout, polling: 100},
    );

    await page.evaluate(() => {
      const SDV = (window as any).SDV;
      const state = (window as any).__sdvAppReadyTracker;
      state?.tokens.forEach((token: string) => SDV.removeListener(token));
      delete (window as any).__sdvAppReadyTracker;
      delete (window as any).__sdvBusyFreeStart;
    });
  }
}

/**
 * Checks whether the current page URL contains the ijewel3d path segment.
 */
export function isIjewel3dUrl(page: Page): boolean {
  return /\/ijewel3d\//.test(page.url());
}
