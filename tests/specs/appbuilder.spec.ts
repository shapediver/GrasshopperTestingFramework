import { test } from "@playwright/test";
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
const scenarioTestTimeout =
  defaults?.testTimeoutMs ?? Math.max(180_000, (defaults?.timeoutMs ?? 90_000) + 60_000);

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

  if (jsErrors.length > 0) {
    throw new Error(
      `Unhandled JS errors on ${scenarioLabel}:\n  ${jsErrors.join("\n  ")}`,
    );
  }
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
          `Output "${result.displayname || result.name || name}" in session "${session}" has no content[0].data.`,
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

    type ExportEntry = {
      name?: string;
      displayname?: string;
      request?: (parameterValues?: Record<string, string>) => Promise<{ content?: unknown[] }>;
    };
    type Session = {
      parameters?: Record<string, { id?: string; name?: string; displayname?: string }>;
      outputs?: Record<string, { name?: string; displayname?: string; content?: Array<{ data?: unknown }> }>;
      getExportByName?: (exportName: string) => ExportEntry[];
    };
    type Instance = { name: string; sessionId: string; parameterValues: Record<string, string> };

    const sessions = (
      window as Window & {
        SDV?: {
          sessions?: Record<string, Session>;
        };
      }
    ).SDV?.sessions;

    // Instances share their backing session and are rendered with
    // customizeParallel(parameterValues). Exporting the backing session without
    // those values would export its current/default state instead.
    const instances: Instance[] = [];
    for (const controller of Object.values(sessions ?? {})) {
      for (const output of Object.values(controller.outputs ?? {})) {
        if (output.name !== "AppBuilder" && output.displayname !== "AppBuilder") continue;
        const appBuilder = output.content?.find((item) => item.data !== undefined)?.data as
          | { instances?: Array<{ name?: string; sessionId?: string; parameterValues?: Record<string, unknown> }> }
          | undefined;
        appBuilder?.instances?.forEach((instance, index) => {
          if (!instance.sessionId) return;
          const instanceSession = sessions?.[instance.sessionId];
          if (!instanceSession) return;
          const parameterValues: Record<string, string> = {};
          for (const [identifier, value] of Object.entries(instance.parameterValues ?? {})) {
            const parameter = Object.values(instanceSession.parameters ?? {}).find(
              (candidate) =>
                candidate.id === identifier ||
                candidate.name === identifier ||
                candidate.displayname === identifier,
            );
            if (parameter?.id) parameterValues[parameter.id] = String(value);
          }
          instances.push({
            name: instance.name ?? `instances[${index}]`,
            sessionId: instance.sessionId,
            parameterValues,
          });
        });
      }
    }

    const instance = instances.find((candidate) => candidate.name === session);
    const sdSession = sessions?.[instance?.sessionId ?? session];
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

    const result = await exportEntry.request(instance?.parameterValues);
    const content = result.content?.[0];
    if (content === undefined) {
      throw new Error(
        `Export "${exportEntry.displayname || exportEntry.name || name}" in session "${session}" has no content[0].`,
      );
    }

    return stripHref(content);
  }, config);
}

// Read every output exposed by every loaded session. App Builder registers model
// instances as sessions too (for example `instance_0`), so this covers both the
// main model and its instances without needing their names in the config.
async function readAllOutputData(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
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

    const sessions = (window as any).SDV?.sessions as
      | Record<
          string,
          {
            outputs?: Record<
              string,
              { id?: string; name?: string; content?: Array<{ data?: unknown }> }
            >;
          }
        >
      | undefined;

    if (!sessions || Object.keys(sessions).length === 0) {
      throw new Error("No SDV sessions are available for output baseline testing.");
    }

    const entries: Array<[string, unknown]> = [];
    for (const [sessionName, session] of Object.entries(sessions)) {
      for (const [outputId, output] of Object.entries(session.outputs ?? {})) {
        const content = output.content ?? [];
        const hasDataItem = content.some((item) => item.data !== undefined);
        entries.push([
          `${sessionName}/${output.name ?? outputId} (${output.id ?? outputId})`,
          // Keep the complete content array so multi-item data outputs are
          // fully tested. Asset/display-only outputs have temporary download
          // URLs removed before comparison.
          hasDataItem ? content : stripHref(content),
        ]);
      }
    }

    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
  });
}

// Request every export from the main session and each App Builder instance.
// Instances sharing a backing session are exported independently with their
// configured parameter values.
async function readAllExportData(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
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

    type ExportEntry = {
      id?: string;
      name?: string;
      displayname?: string;
      request?: (parameterValues?: Record<string, string>) => Promise<{ content?: unknown[] }>;
    };
    type Session = {
      parameters?: Record<string, { id?: string; name?: string; displayname?: string }>;
      outputs?: Record<string, { name?: string; displayname?: string; content?: Array<{ data?: unknown }> }>;
      exports?: Record<string, ExportEntry>;
    };
    type Instance = { name: string; sessionId: string; parameterValues: Record<string, string> };
    const sessions = (window as any).SDV?.sessions as
      | Record<string, Session>
      | undefined;

    if (!sessions || Object.keys(sessions).length === 0) {
      throw new Error("No SDV sessions are available for export baseline testing.");
    }

    const instances: Instance[] = [];
    for (const controller of Object.values(sessions)) {
      for (const output of Object.values(controller.outputs ?? {})) {
        if (output.name !== "AppBuilder" && output.displayname !== "AppBuilder") continue;
        const appBuilder = output.content?.find((item) => item.data !== undefined)?.data as
          | { instances?: Array<{ name?: string; sessionId?: string; parameterValues?: Record<string, unknown> }> }
          | undefined;
        appBuilder?.instances?.forEach((instance, index) => {
          if (!instance.sessionId) return;
          const instanceSession = sessions[instance.sessionId];
          if (!instanceSession) return;
          const parameterValues: Record<string, string> = {};
          for (const [identifier, value] of Object.entries(instance.parameterValues ?? {})) {
            const parameter = Object.values(instanceSession.parameters ?? {}).find(
              (candidate) =>
                candidate.id === identifier ||
                candidate.name === identifier ||
                candidate.displayname === identifier,
            );
            if (parameter?.id) parameterValues[parameter.id] = String(value);
          }
          instances.push({
            name: instance.name ?? `instances[${index}]`,
            sessionId: instance.sessionId,
            parameterValues,
          });
        });
      }
    }

    const entries: Array<[string, unknown]> = [];
    const instanceSessionIds = new Set(instances.map((instance) => instance.sessionId));
    for (const [sessionName, session] of Object.entries(sessions)) {
      // These sessions are implementation details for the instances below.
      if (instanceSessionIds.has(sessionName)) continue;
      for (const [exportId, exportEntry] of Object.entries(session.exports ?? {})) {
        if (!exportEntry.request) {
          throw new Error(
            `Export "${exportEntry.displayname || exportEntry.name || exportId}" in session "${sessionName}" has no request().`,
          );
        }
        const result = await exportEntry.request();
        entries.push([
          `${sessionName}/${exportEntry.name ?? exportId} (${exportEntry.id ?? exportId})`,
          // Some valid exports (for example email exports) return no download
          // content. Requesting them is still the behavior under test, and an
          // empty array gives them a stable baseline value.
          stripHref(result.content ?? []),
        ]);
      }
    }

    for (const instance of instances) {
      const instanceSession = sessions[instance.sessionId];
      for (const [exportId, exportEntry] of Object.entries(instanceSession.exports ?? {})) {
        if (!exportEntry.request) {
          throw new Error(
            `Export "${exportEntry.displayname || exportEntry.name || exportId}" in instance "${instance.name}" has no request().`,
          );
        }
        const result = await exportEntry.request(instance.parameterValues);
        entries.push([
          `${instance.name}/${exportEntry.name ?? exportId} (${exportEntry.id ?? exportId})`,
          stripHref(result.content ?? []),
        ]);
      }
    }

    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
  });
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
    // Give rendering and the test action independent budget. A readiness wait
    // may legitimately consume most of timeoutMs for heavy WebGi scenes.
    test.describe.configure({timeout: scenarioTestTimeout});

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

    if (scenario.outputs === "all") {
      test("@outputs all output baselines", async ({ page }) => {
        await openScenario(page, url, baselineId, setup);
        await assertJsonBaseline(
          `outputs/${baselineId}-all`,
          await readAllOutputData(page),
        );
      });
    }

    for (const output of scenario.outputs === "all" ? [] : (scenario.outputs ?? [])) {
      test(`@outputs output baseline: ${output.name}`, async ({ page }) => {
        await openScenario(page, url, baselineId, setup);
        const actual = await readOutputData(page, output);
        await assertJsonBaseline(
          `outputs/${baselineId}-${output.name}`,
          actual,
        );
      });
    }

    if (scenario.exports === "all") {
      test("@exports all export baselines", async ({ page }) => {
        await openScenario(page, url, baselineId, setup);
        await assertJsonBaseline(
          `exports/${baselineId}-all`,
          await readAllExportData(page),
        );
      });
    }

    for (const exportConfig of scenario.exports === "all" ? [] : (scenario.exports ?? [])) {
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
