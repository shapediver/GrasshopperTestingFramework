import { Page } from "@playwright/test";

/**
 * Performs an action and waits until its customized model has completed its
 * final beauty render and instance-scene updates.
 *
 * `session.customized` alone is too early for AppBuilder instances: it is
 * emitted before the AppBuilder instance pipeline finishes updating the scene
 * tree. A beauty-render event that occurred before that customization must
 * also be ignored, so both listeners are installed before the action and the
 * render event is only accepted after customization was observed. Any viewport
 * busy cycle invalidates an already-observed beauty render, so the helper waits
 * for the next one. When no beauty event follows (for example during
 * continuous rendering), a longer uninterrupted non-busy period is used.
 * iJewel uses WebGi, so it waits for its loading overlay instead.
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
      beautyRenderFinishedAt: 0,
      busyFreeSince: 0,
      lastBusyOnAt: 0,
      lastBusyOffAt: 0,
      lastCustomizationAt: 0,
      loadingScreenSeen: false,
      loadingScreenIdleSince: 0,
      customizationToken: "",
      beautyRenderToken: "",
      busyOnToken: "",
      busyOffToken: "",
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
        // AppBuilder instances can trigger follow-up customizations. A beauty
        // event from an earlier pass must not satisfy the later one.
        state.beautyRenderFinished = false;
        state.beautyRenderFinishedAt = 0;
        state.busyFreeSince = 0;
        state.lastCustomizationAt = Date.now();
        if (isIjewel3d && isLoadingScreenVisible())
          state.loadingScreenSeen = true;
      },
    );
    if (!isIjewel3d) {
      const viewports = Object.values(SDV.viewports ?? {}) as any[];
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
          // Ignore any render that was already in progress before this action's
          // customization. This commonly happens while an AppBuilder instance
          // pipeline is still replacing scene-tree nodes.
          const currentViewports = Object.values(
            SDV.viewports ?? {},
          ) as any[];
          const allViewportsIdle = currentViewports.every(
            (viewport) =>
              viewport.busy !== true && viewport.isBusy !== true,
          );
          if (state.customized && allViewportsIdle) {
            state.beautyRenderFinished = true;
            state.beautyRenderFinishedAt = Date.now();
          }
        },
      );
      state.busyOnToken = SDV.addListener(
        SDV.EVENTTYPE?.VIEWPORT?.BUSY_MODE_ON ?? "viewport.busy.on",
        () => {
          // A subsequent AppBuilder process can begin after a beauty event.
          // Discard that event and wait for the render of the new final scene.
          state.beautyRenderFinished = false;
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
        const allViewportsIdle = viewports.every(
          (viewport) => viewport.busy !== true && viewport.isBusy !== true,
        );
        if (!allViewportsIdle) {
          // Polling is also a fallback for older viewer bundles that do not
          // emit viewport busy events.
          state.beautyRenderFinished = false;
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
          state.lastCustomizationAt,
          state.lastBusyOnAt,
          state.lastBusyOffAt,
        );

        if (
          state.beautyRenderFinished &&
          state.beautyRenderFinishedAt >= lastModelEventAt &&
          now -
            Math.max(
              state.beautyRenderFinishedAt,
              state.busyFreeSince,
            ) >=
            500
        )
          return true;

        // `continuousRendering` is internal to the rendering engine and is not
        // exposed by IViewportApi. If no beauty event follows, use a longer
        // uninterrupted idle window as the completion signal.
        return (
          now - Math.max(lastModelEventAt, state.busyFreeSince) >= 2_000
        );
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
        if (state.busyOnToken) SDV.removeListener(state.busyOnToken);
        if (state.busyOffToken) SDV.removeListener(state.busyOffToken);
        state.loadingScreenObserver?.disconnect();
      }
      delete (window as any).__sdvModelRecomputed;
    });
  }
}
