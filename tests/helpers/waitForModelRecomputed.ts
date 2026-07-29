import { Page } from "@playwright/test";

/**
 * Performs an action and waits until its customized model has completed its
 * final beauty render and instance-scene updates.
 *
 * `session.customized` alone is too early for AppBuilder instances: it is
 * emitted before the AppBuilder instance pipeline finishes updating the scene
 * tree. A beauty-render event that occurred before that customization must
 * also be ignored, so both listeners are installed before the action and the
 * render event is only accepted after customization was observed. Both normal
 * and continuous rendering must then leave every viewport continuously idle:
 * App Builder can receive a beauty-render event before its instance pipeline
 * finishes updating the scene tree. iJewel uses WebGi, so it waits for its
 * loading overlay instead.
 */
export async function waitForModelRecomputed(
  page: Page,
  action: () => Promise<void>,
  timeout = 90_000,
): Promise<void> {
  const isIjewel3d = /\/ijewel3d\//.test(page.url());

  await page.evaluate((isIjewel3d) => {
    const SDV = (window as any).SDV;
    const state = {
      isIjewel3d,
      customized: false,
      beautyRenderFinished: false,
      busyFreeSince: 0,
      lastCustomizationAt: 0,
      loadingScreenSeen: false,
      loadingScreenIdleSince: 0,
      customizationToken: "",
      beautyRenderToken: "",
      loadingScreenObserver: null as MutationObserver | null,
    };

    (window as any).__sdvModelRecomputed = state;

    const isLoadingScreenVisible = () => {
      const loadingScreen = document.querySelector(
        "#assetManagerLoadingScreen",
      );
      if (!loadingScreen) return false;
      const style = getComputedStyle(loadingScreen);
      return style.display !== "none" && style.visibility !== "hidden";
    };

    if (isIjewel3d) {
      state.loadingScreenObserver = new MutationObserver(() => {
        if (isLoadingScreenVisible()) {
          state.loadingScreenSeen = true;
          state.loadingScreenIdleSince = 0;
        }
      });
      state.loadingScreenObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
        childList: true,
        subtree: true,
      });
    }

    state.customizationToken = SDV.addListener(
      SDV.EVENTTYPE?.SESSION?.SESSION_CUSTOMIZED ?? "session.customized",
      () => {
        state.customized = true;
        state.lastCustomizationAt = Date.now();
        state.busyFreeSince = 0;
        if (isIjewel3d && isLoadingScreenVisible())
          state.loadingScreenSeen = true;
      },
    );
    if (!isIjewel3d) {
      state.beautyRenderToken = SDV.addListener(
        SDV.EVENTTYPE?.RENDERING?.BEAUTY_RENDERING_FINISHED ??
          "rendering.beautyRenderingFinished",
        () => {
          // Ignore any render that was already in progress before this action's
          // customization. This commonly happens while an AppBuilder instance
          // pipeline is still replacing scene-tree nodes.
          const viewports = Object.values(SDV.viewports ?? {}) as any[];
          const continuousRendering = viewports.some(
            (viewport) => viewport.continuousRendering === true,
          );
          if (state.customized && !continuousRendering)
            state.beautyRenderFinished = true;
        },
      );
    }
  }, isIjewel3d);

  try {
    await action();

    await page.waitForFunction(
      () => {
        const state = (window as any).__sdvModelRecomputed;
        if (!state?.customized) return false;

        if (state.isIjewel3d) {
          const loadingScreen = document.querySelector(
            "#assetManagerLoadingScreen",
          );
          const style = loadingScreen && getComputedStyle(loadingScreen);
          const loading =
            !!style &&
            style.display !== "none" &&
            style.visibility !== "hidden";
          if (loading) {
            state.loadingScreenSeen = true;
            state.loadingScreenIdleSince = 0;
            return false;
          }
          if (state.loadingScreenSeen) return true;

          const now = Date.now();
          if (!state.loadingScreenIdleSince) {
            state.loadingScreenIdleSince = now;
            return false;
          }
          return now - state.loadingScreenIdleSince >= 500;
        }

        const viewports = Object.values(
          (window as any).SDV?.viewports ?? {},
        ) as any[];
        if (viewports.length === 0) return false;
        const continuousRendering = viewports.some(
          (viewport) => viewport.continuousRendering === true,
        );
        // A non-continuous viewport needs its final render event; a
        // continuously-rendered viewport does not emit one.
        if (!continuousRendering && !state.beautyRenderFinished) return false;

        const allViewportsIdle = viewports.every(
          (viewport) => !(viewport.busy ?? viewport.isBusy),
        );
        if (!allViewportsIdle) {
          state.busyFreeSince = 0;
          return false;
        }

        const now = Date.now();
        // Let any related SESSION_CUSTOMIZED notifications from App Builder
        // instances arrive before accepting an otherwise-idle viewport.
        if (now - state.lastCustomizationAt < 500) return false;
        if (!state.busyFreeSince) {
          state.busyFreeSince = now;
          return false;
        }

        // Allow the continuously-rendered scene to paint after its final
        // process/busy cycle has completed.
        return now - state.busyFreeSince >= 500;
      },
      undefined,
      { timeout },
    );
  } finally {
    await page.evaluate(() => {
      const SDV = (window as any).SDV;
      const state = (window as any).__sdvModelRecomputed;

      if (state) {
        SDV.removeListener(state.customizationToken);
        if (state.beautyRenderToken)
          SDV.removeListener(state.beautyRenderToken);
        state.loadingScreenObserver?.disconnect();
      }
      delete (window as any).__sdvModelRecomputed;
    });
  }
}
