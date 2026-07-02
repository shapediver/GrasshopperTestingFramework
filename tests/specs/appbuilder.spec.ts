import { expect, test } from "@playwright/test";
import type { ISessionApi, ITreeNode } from "@shapediver/viewer";
import { scenarioActionById } from "../config/scenarioActions";
import { assertJsonBaseline } from "../helpers/assertJsonBaseline";
import {
  ExportBaselineConfig,
  loadScenarios,
  OutputBaselineConfig,
} from "../helpers/loadScenarios";
import { resolveTargetUrl } from "../helpers/resolveTargetUrl";
import { takeSnapshot } from "../helpers/takeSnapshot";
import { waitForAppReady } from "../helpers/waitForAppReady";

const { defaults, scenarios } = loadScenarios();

// Open a scenario, wait until App Builder is ready, and fail early on obvious page issues.
async function openScenario(
  page: import("@playwright/test").Page,
  url: string,
  scenarioLabel: string,
  setup?: (page: import("@playwright/test").Page) => Promise<void>,
) {
  const jsErrors: string[] = [];
  page.on("pageerror", (error) => jsErrors.push(error.message));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page, {
    timeout: defaults?.timeoutMs,
    interstitial: setup,
  });

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: defaults?.timeoutMs });
  const box = await canvas.boundingBox();
  expect(box, `Canvas has no bounding box for ${scenarioLabel}`).not.toBeNull();
  expect(box!.width, `Canvas width is 0 for ${scenarioLabel}`).toBeGreaterThan(
    0,
  );
  expect(
    box!.height,
    `Canvas height is 0 for ${scenarioLabel}`,
  ).toBeGreaterThan(0);

  expect(
    jsErrors,
    `Unhandled JS errors on ${scenarioLabel}:\n  ${jsErrors.join("\n  ")}`,
  ).toHaveLength(0);
}

// Read output JSON either from the requested SDV session or, if that session does
// not exist, from instance outputs stored on scene-tree nodes.
async function readOutputData(
  page: import("@playwright/test").Page,
  config: OutputBaselineConfig,
) {
  return page.evaluate(({ session = "default", name }) => {
    type ResponseOutput = {
      id?: string;
      name?: string;
      displayname?: string;
      content?: Array<{ data?: unknown }>;
    };

    type ResponseDtoData = {
      responseDto?: {
        outputs?: Record<string, ResponseOutput>;
      };
    };

    const sessions = (window as any).SDV?.sessions as
      | Record<string, ISessionApi>
      | undefined;
    const root = (window as any).SDV?.sceneTree?.root as ITreeNode | undefined;

    const targetSession = sessions?.[session];
    if (targetSession) {
      const result = targetSession.getOutputByName(name)?.[0];
      if (!result) {
        throw new Error(`Output "${name}" not found in session "${session}".`);
      }

      const data = result.content?.[0]?.data;
      if (data === undefined) {
        throw new Error(
          `Output "${name}" in session "${session}" has no content[0].data.`,
        );
      }
      return data;
    }

    if (!root?.traverse) {
      throw new Error(
        `SDV.sessions[${session}] is not available and the scene tree cannot be traversed for instance outputs.`,
      );
    }

    // In AppBuilderSdk, instance outputs are attached to instance scene nodes. When the
    // requested session is not present in SDV.sessions, find the matching instance node
    // first and then inspect its data using traverseData so we follow the SDK's node APIs.
    const normalizedTarget = name.toLowerCase();
    const matchesTarget = (responseOutput?: ResponseOutput) => {
      const identifiers = [
        responseOutput?.name,
        responseOutput?.displayname,
        responseOutput?.id,
      ]
        .filter((value): value is string => !!value)
        .map((value) => value.toLowerCase());

      return identifiers.includes(normalizedTarget);
    };

    let instanceNode: ITreeNode | undefined;
    root.traverse((node: ITreeNode) => {
      if (!instanceNode && node.name === session) {
        instanceNode = node;
      }
    });

    if (!instanceNode?.traverseData) {
      throw new Error(
        `SDV.sessions[${session}] is not available and no instance node named "${session}" was found in the scene tree.`,
      );
    }

    let instanceData: unknown = undefined;
    instanceNode.traverseData((data: unknown) => {
      if (instanceData !== undefined) return;

      const outputs = (data as ResponseDtoData | undefined)?.responseDto?.outputs;
      if (!outputs) return;

      for (const output of Object.values(outputs)) {
        if (matchesTarget(output)) {
          instanceData = output.content?.[0]?.data;
          return;
        }
      }
    });

    if (instanceData === undefined) {
      throw new Error(
        `SDV.sessions[${session}] is not available and no matching instance output named "${name}" was found on instance node "${session}".`,
      );
    }

    return instanceData;
  }, config);
}

// Read export JSON and remove href fields before baseline comparison.
async function readExportData(
  page: import("@playwright/test").Page,
  config: ExportBaselineConfig,
) {
  return page.evaluate(async ({ session = "default", name }) => {
    const stripHref = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripHref);

      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([key]) => key !== "href")
            .map(([key, nestedValue]) => [key, stripHref(nestedValue)]),
        );
      }

      return value;
    };

    const sessions = (
      window as Window & {
        SDV?: {
          sessions?: Record<
            string,
            {
              getExportByName?: (
                exportName: string,
              ) => Array<{ request?: () => Promise<{ content?: unknown[] }> }>;
            }
          >;
        };
      }
    ).SDV?.sessions;
    const sdSession = sessions?.[session];
    if (!sdSession?.getExportByName) {
      throw new Error(
        `SDV.sessions[${session}] is not available or has no getExportByName().`,
      );
    }

    const exportEntry = sdSession.getExportByName(name)?.[0];
    if (!exportEntry?.request) {
      throw new Error(
        `Export "${name}" not found in session "${session}" or has no request().`,
      );
    }

    const result = await exportEntry.request();
    const content = result.content?.[0];
    if (content === undefined) {
      throw new Error(
        `Export "${name}" in session "${session}" has no content[0].`,
      );
    }

    return stripHref(content);
  }, config);
}

// Playwright requires unique test titles, even when multiple scenarios intentionally
// share the same public id. Expanded array-param scenarios get their own baseline ids,
// while manually duplicated ids can still intentionally share one baseline.
const scenarioTitleCounts = new Map<string, number>();

for (const scenario of scenarios) {
  const config = scenarioActionById.get(scenario.id);
  const setup = config?.setup;
  const actions = config?.actions;
  const url = resolveTargetUrl(scenario);
  const baselineId = scenario.baselineId ?? scenario.id;
  const titleCount = (scenarioTitleCounts.get(baselineId) ?? 0) + 1;
  scenarioTitleCounts.set(baselineId, titleCount);
  const internalTitle =
    titleCount === 1
      ? baselineId
      : `${baselineId}${"\u200B".repeat(titleCount - 1)}`;

  test.describe(internalTitle, () => {
    test("@simple-screenshots baseline screenshot", async ({ page }) => {
      await openScenario(page, url, baselineId, setup);
      await takeSnapshot(page, baselineId);
    });

    if (actions) {
      test("@interaction example interaction flow", async ({ page }) => {
        await openScenario(page, url, baselineId, setup);
        await actions(page, baselineId);
      });
    }

    for (const output of scenario.outputs ?? []) {
      test(`@outputs output baseline: ${output.name}`, async ({ page }) => {
        await openScenario(page, url, baselineId, setup);
        const actual = await readOutputData(page, output);
        await assertJsonBaseline(
          `outputs/${baselineId}-${output.name}`,
          actual,
        );
      });
    }

    for (const exportConfig of scenario.exports ?? []) {
      test(`@exports export baseline: ${exportConfig.name}`, async ({
        page,
      }) => {
        await openScenario(page, url, baselineId, setup);
        const actual = await readExportData(page, exportConfig);
        await assertJsonBaseline(
          `exports/${baselineId}-${exportConfig.name}`,
          actual,
        );
      });
    }
  });
}
