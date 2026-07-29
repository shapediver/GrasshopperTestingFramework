import * as fs from "fs";
import * as path from "path";

type Scalar = string | number | boolean;
type RawParam = Scalar | Scalar[];

/** Params type in the JSON config — values may be scalar or arrays. */
export type ScenarioUrlParams = Record<string, Scalar>;
type ScenarioUrlParamsInput = Record<string, RawParam>;

export interface OutputBaselineConfig {
  session?: string;
  name: string;
}

export interface ExportBaselineConfig {
  session?: string;
  name: string;
}

/** Use `"all"` to baseline every item exposed by every loaded SDV session. */
export type BaselineSelection<T> = T[] | "all";

export interface ScenarioConfig {
  id: string;
  slug?: string;
  customUrl?: string;
  baseUrl?: string;
  params?: ScenarioUrlParamsInput;
  outputs?: BaselineSelection<OutputBaselineConfig>;
  exports?: BaselineSelection<ExportBaselineConfig>;
  baselineId?: string;
}

export interface ScenarioFile {
  defaults?: {
    timeoutMs?: number;
    slug?: string;
    baseUrl?: string;
    params?: ScenarioUrlParamsInput;
    outputs?: BaselineSelection<OutputBaselineConfig>;
    exports?: BaselineSelection<ExportBaselineConfig>;
  };
  scenarios: ScenarioConfig[];
}

const SCENARIO_PATH = path.resolve("tests/config/scenarios.json");

function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  const [first, ...rest] = arrays;
  const restProduct = cartesianProduct(rest);
  return first.flatMap((item) => restProduct.map((combo) => [item, ...combo]));
}

function mergeByKey<T>(
  defaults: T[] | undefined,
  overrides: T[] | undefined,
  getKey: (item: T) => string,
): T[] | undefined {
  if (!defaults?.length && !overrides?.length) return undefined;

  const merged = new Map<string, T>();
  for (const item of defaults ?? []) merged.set(getKey(item), item);
  for (const item of overrides ?? []) merged.set(getKey(item), item);
  return [...merged.values()];
}

function mergeBaselineSelection<T>(
  defaults: BaselineSelection<T> | undefined,
  overrides: BaselineSelection<T> | undefined,
  getKey: (item: T) => string,
): BaselineSelection<T> | undefined {
  // "all" deliberately wins: a project default should not silently stop
  // checking newly added outputs or exports, and a scenario can opt into it.
  if (defaults === "all" || overrides === "all") return "all";
  return mergeByKey(defaults, overrides, getKey);
}

function createExpandedBaselineId(
  baseId: string,
  expandedEntries: Array<[string, Scalar]>,
): string {
  if (expandedEntries.length === 0) return baseId;

  const suffix = expandedEntries
    .map(([key, value]) => `${key}-${String(value)}`)
    .join("-");

  return `${baseId}-${suffix}`;
}

function expandScenarioArrays(config: ScenarioConfig): ScenarioConfig[] {
  if (!config.params) return [{...config, baselineId: config.baselineId ?? config.id}];

  const scalarParams: Record<string, Scalar> = {};
  const arrayParams: [string, Scalar[]][] = [];

  for (const [key, value] of Object.entries(config.params)) {
    if (Array.isArray(value)) {
      if (value.length > 0) arrayParams.push([key, value]);
    } else {
      scalarParams[key] = value;
    }
  }

  if (arrayParams.length === 0) {
    return [{...config, baselineId: config.baselineId ?? config.id, params: scalarParams}];
  }

  const combinations = cartesianProduct(arrayParams.map(([_, values]) => values));

  return combinations.map((combination) => {
    const expandedEntries = arrayParams.map(
      ([key], i) => [key, combination[i]] as [string, Scalar],
    );

    return {
      ...config,
      id: config.id,
      baselineId: createExpandedBaselineId(config.id, expandedEntries),
      params: {
        ...scalarParams,
        ...Object.fromEntries(expandedEntries),
      },
    };
  });
}

function mergeScenarioDefaults(
  scenario: ScenarioConfig,
  defaults?: ScenarioFile["defaults"],
): ScenarioConfig {
  if (!defaults) return {...scenario, baselineId: scenario.baselineId ?? scenario.id};

  return {
    ...scenario,
    baselineId: scenario.baselineId ?? scenario.id,
    slug: scenario.slug ?? defaults.slug,
    baseUrl: scenario.baseUrl ?? defaults.baseUrl,
    params:
      defaults.params || scenario.params
        ? {...(defaults.params ?? {}), ...(scenario.params ?? {})}
        : undefined,
    outputs: mergeBaselineSelection(
      defaults.outputs,
      scenario.outputs,
      (item) => `${item.session ?? "default"}/${item.name}`,
    ),
    exports: mergeBaselineSelection(
      defaults.exports,
      scenario.exports,
      (item) => `${item.session ?? "default"}/${item.name}`,
    ),
  };
}

function urlHasSlug(urlString?: string): boolean {
  if (!urlString) return false;

  try {
    return new URL(urlString).searchParams.has("slug");
  } catch {
    return false;
  }
}

export function getScenarioConfigPath(): string {
  return SCENARIO_PATH;
}

export function loadScenarioFile(): ScenarioFile {
  if (!fs.existsSync(SCENARIO_PATH)) {
    throw new Error(
      `Scenario config not found: ${SCENARIO_PATH}. Create tests/config/scenarios.json first.`,
    );
  }

  const parsed = JSON.parse(
    fs.readFileSync(SCENARIO_PATH, "utf8"),
  ) as ScenarioFile;

  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error(
      `No scenarios found in ${SCENARIO_PATH}. Add at least one scenario entry.`,
    );
  }

  const defaultHasSlug = !!parsed.defaults?.slug;
  const defaultUrlHasSlug = urlHasSlug(parsed.defaults?.baseUrl);
  const envUrlHasSlug = urlHasSlug(process.env.APPBUILDER_BASE_URL?.trim());

  for (const scenario of parsed.scenarios) {
    if (!scenario.id) {
      throw new Error(
        `Missing "id" in ${SCENARIO_PATH}. Every scenario must have a non-empty "id". Reusing the same id across scenarios is allowed.`,
      );
    }

    const scenarioHasSlugSource =
      !!scenario.slug ||
      defaultHasSlug ||
      urlHasSlug(scenario.customUrl) ||
      urlHasSlug(scenario.baseUrl) ||
      defaultUrlHasSlug ||
      envUrlHasSlug;

    if (!scenarioHasSlugSource) {
      throw new Error(
        `Scenario "${scenario.id}" is missing a slug source in ${SCENARIO_PATH}. Provide scenario.slug, defaults.slug, or a URL that already contains ?slug=.`,
      );
    }
  }

  return parsed;
}

export function loadScenarios(): {
  defaults: {timeoutMs?: number};
  scenarios: ScenarioConfig[];
} {
  const file = loadScenarioFile();

  const expanded = file.scenarios.flatMap((scenario) => {
    const merged = mergeScenarioDefaults(scenario, file.defaults);
    return expandScenarioArrays(merged);
  });

  return {
    defaults: file.defaults?.timeoutMs ? {timeoutMs: file.defaults.timeoutMs} : {},
    scenarios: expanded,
  };
}
