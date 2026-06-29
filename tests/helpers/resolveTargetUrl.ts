import {ScenarioConfig} from "./loadScenarios";

type Params = Record<string, string | number | boolean>;

const DEFAULT_HOST = "https://appbuilder.shapediver.com/v1/main";

const DEFAULT_VERSION = "latest";

function applyParams(url: URL, params?: Params) {
  if (!params) return;

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
}

export function resolveTargetUrl(scenario: ScenarioConfig): string {
  const envVersion = process.env.APPBUILDER_VERSION?.trim();
  const envBaseUrl = process.env.APPBUILDER_BASE_URL?.trim();
  const version = envVersion || DEFAULT_VERSION;

  const baseUrl = scenario.customUrl || envBaseUrl || `${DEFAULT_HOST}/${version}/`;
  const url = new URL(baseUrl);

  if (!url.searchParams.has("slug")) {
    url.searchParams.set("slug", scenario.slug);
  }

  applyParams(url, scenario.params as Params | undefined);

  return url.toString();
}
