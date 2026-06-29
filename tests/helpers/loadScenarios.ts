import * as fs from "fs";
import * as path from "path";

type Scalar = string | number | boolean;
type RawParam = Scalar | Scalar[];

/** Params type in the JSON config — values may be scalar or arrays. */
export type ScenarioUrlParams = Record<string, Scalar>;
type ScenarioUrlParamsInput = Record<string, RawParam>;

export interface ScenarioConfig {
  id: string;
  slug: string;
  customUrl?: string;
  params?: ScenarioUrlParamsInput;
}

export interface ScenarioFile {
  defaults?: {
    timeoutMs?: number;
    params?: ScenarioUrlParamsInput;
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

function expandScenarioArrays(config: ScenarioConfig): ScenarioConfig[] {
  if (!config.params) return [config];

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
    return [{...config, params: scalarParams}];
  }

  const combinations = cartesianProduct(arrayParams.map(([_, values]) => values));

  return combinations.map((combination) => {
    const suffix = combination.map(String).join("-");
    return {
      ...config,
      id: `${config.id}-${suffix}`,
      params: {
        ...scalarParams,
        ...Object.fromEntries(
          arrayParams.map(([key], i) => [key, combination[i]]),
        ),
      },
    };
  });
}

function mergeDefaultParams(
  scenario: ScenarioConfig,
  defaultParams?: ScenarioUrlParamsInput,
): ScenarioConfig {
  if (!defaultParams || Object.keys(defaultParams).length === 0) return scenario;
  return {
    ...scenario,
    params: {...defaultParams, ...scenario.params},
  };
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

  for (const scenario of parsed.scenarios) {
    if (!scenario.id) {
      throw new Error(
        `Missing "id" in ${SCENARIO_PATH}. Every scenario must have a unique "id".`,
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
  const defaultParams = file.defaults?.params;

  const expanded = file.scenarios.flatMap((scenario) => {
    const merged = mergeDefaultParams(scenario, defaultParams);
    return expandScenarioArrays(merged);
  });

  return {
    defaults: file.defaults?.timeoutMs ? {timeoutMs: file.defaults.timeoutMs} : {},
    scenarios: expanded,
  };
}
