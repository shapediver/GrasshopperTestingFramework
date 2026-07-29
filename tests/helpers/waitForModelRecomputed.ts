import {Page} from "@playwright/test";

/**
 * Performs an action and waits until its customized model has completed its
 * final beauty render.
 *
 * `session.customized` alone is too early for AppBuilder instances: it is
 * emitted before the AppBuilder instance pipeline finishes updating the scene
 * tree. A beauty-render event that occurred before that customization must
 * also be ignored, so both listeners are installed before the action and the
 * render event is only accepted after customization was observed. Continuous
 * rendering does not emit a beauty-render completion event; in that mode a
 * stable, non-busy viewport is the completion signal instead.
 */
export async function waitForModelRecomputed(
  page: Page,
  action: () => Promise<void>,
  timeout = 90_000,
): Promise<void> {
  await page.evaluate(() => {
    const SDV = (window as any).SDV;
    const state = {
      customized: false,
      beautyRenderFinished: false,
      busyFreeSince: 0,
      customizationToken: "",
      beautyRenderToken: "",
    };

    (window as any).__sdvModelRecomputed = state;

    state.customizationToken = SDV.addListener(
      SDV.EVENTTYPE?.SESSION?.SESSION_CUSTOMIZED ?? "session.customized",
      () => {
        state.customized = true;
      },
    );
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
  });

  try {
    await action();

    await page.waitForFunction(
      () => {
        const state = (window as any).__sdvModelRecomputed;
        if (!state?.customized) return false;
        if (state.beautyRenderFinished) return true;

        const viewports = Object.values((window as any).SDV?.viewports ?? {}) as any[];
        const continuousRendering = viewports.some(
          (viewport) => viewport.continuousRendering === true,
        );
        if (!continuousRendering) return false;

        const allViewportsIdle = viewports.every(
          (viewport) => !(viewport.busy ?? viewport.isBusy),
        );
        if (!allViewportsIdle) {
          state.busyFreeSince = 0;
          return false;
        }

        const now = Date.now();
        if (!state.busyFreeSince) {
          state.busyFreeSince = now;
          return false;
        }

        // Allow the continuously-rendered scene to paint after its final
        // process/busy cycle has completed.
        return now - state.busyFreeSince >= 500;
      },
      {timeout},
    );
  } finally {
    await page.evaluate(() => {
      const SDV = (window as any).SDV;
      const state = (window as any).__sdvModelRecomputed;

      if (state) {
        SDV.removeListener(state.customizationToken);
        SDV.removeListener(state.beautyRenderToken);
      }
      delete (window as any).__sdvModelRecomputed;
    });
  }
}
