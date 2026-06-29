import { expect, Page } from "@playwright/test";
import { takeSnapshot } from "../helpers/takeSnapshot";
import { waitForModelRecomputed } from "../helpers/waitForModelRecomputed";
import { viewportCoords } from "../helpers/viewportCoords";
import { getParameterElement } from "../helpers/getParameterElement";

export interface ScenarioActionConfig {
  id: string;
  /**
   * Optional steps that must happen after navigation but before the app is fully ready.
   * Useful for required file uploads or similar pre-compute setup.
   */
  setup?: (page: Page) => Promise<void>;
  /**
   * Default place for interaction tests.
   * See ./README.md for copy-paste templates and parameter targeting examples.
   */
  actions?: (page: Page, scenarioId: string) => Promise<void>;
}

/**
 * See ./README.md for the App Builder Testing Guide with:
 * - Parameter targeting examples (slider, text input, dropdown, etc.)
 * - Two important rules (await, waitForModelRecomputed)
 * - Copy-paste templates (tab click, 3D scene click, slider, upload, download)
 */

export const scenarioActions: ScenarioActionConfig[] = [
  {
    id: "barcelona",
    actions: async (page, scenarioId) => {
      // select the "Edit Blocks" button and click it
      const button = page.getByRole("tab", { name: "Edit Blocks" });
      await button.click();

      // take a screenshot
      await takeSnapshot(page, `${scenarioId}-block-tab`);

      // click on the "Start Selection" button
      const startSelectionButton = page.getByRole("button", {
        name: "Start Selection",
      });
      await startSelectionButton.click();

      // click on a block in the scene
      const blockCoords = await viewportCoords(page, 0.144, 0.302);
      await waitForModelRecomputed(page, async () => {
        await page.mouse.click(blockCoords.x, blockCoords.y);
      });

      // take a screenshot
      await takeSnapshot(page, `${scenarioId}-block-selected`);

      // change the slider value of "Block Size" to 0.8
      const blockSizeSlider = getParameterElement(page, "Block Size").getByRole(
        "textbox",
      );
      await waitForModelRecomputed(page, async () => {
        await blockSizeSlider.fill("0.8");
        await blockSizeSlider.press("Enter");
      });

      // take a screenshot
      await takeSnapshot(page, `${scenarioId}-block-size-changed`);
    },
  },
];

export const scenarioActionById = new Map(
  scenarioActions.map((config) => [config.id, config]),
);
