import {expect, test} from "@playwright/test";
import {scenarioActionById} from "../config/scenarioActions";
import {loadScenarios} from "../helpers/loadScenarios";
import {resolveTargetUrl} from "../helpers/resolveTargetUrl";
import {takeSnapshot} from "../helpers/takeSnapshot";
import {waitForAppReady} from "../helpers/waitForAppReady";

const {defaults, scenarios} = loadScenarios();

async function openScenario(
  page: import("@playwright/test").Page,
  url: string,
  scenarioId: string,
  setup?: (page: import("@playwright/test").Page) => Promise<void>,
) {
  const jsErrors: string[] = [];
  page.on("pageerror", (error) => jsErrors.push(error.message));

  await page.goto(url, {waitUntil: "domcontentloaded"});
  await waitForAppReady(page, {
    timeout: defaults?.timeoutMs,
    interstitial: setup,
  });

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, `Canvas has no bounding box for ${scenarioId}`).not.toBeNull();
  expect(box!.width, `Canvas width is 0 for ${scenarioId}`).toBeGreaterThan(0);
  expect(box!.height, `Canvas height is 0 for ${scenarioId}`).toBeGreaterThan(0);

  expect(
    jsErrors,
    `Unhandled JS errors on ${scenarioId}:\n  ${jsErrors.join("\n  ")}`,
  ).toHaveLength(0);
}

for (const scenario of scenarios) {
  const config = scenarioActionById.get(scenario.id);
  const setup = config?.setup;
  const actions = config?.actions;
  const url = resolveTargetUrl(scenario);

  test.describe(`${scenario.id}`, () => {
    test("@simple-screenshots baseline screenshot", async ({page}) => {
      await openScenario(page, url, scenario.id, setup);
      await takeSnapshot(page, scenario.id);
    });

    if (actions) {
      test("@interaction example interaction flow", async ({page}) => {
        await openScenario(page, url, scenario.id, setup);
        await actions(page, scenario.id);
      });
    }
  });
}
