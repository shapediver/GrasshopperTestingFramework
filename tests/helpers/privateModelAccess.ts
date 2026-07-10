import * as fs from "fs";
import * as path from "path";
import type {ScenarioConfig} from "./loadScenarios";

const PRIVATE_MODEL_ACCESS_CACHE_PATH = path.resolve(
  "tests/config/.private-model-access.json",
);

export interface PrivateModelAccessEntry {
  slug: string;
  ticket: string;
  modelViewUrl: string;
  accessToken: string;
}

export interface PrivateModelAccessCache {
  version: 1;
  generatedAt: string;
  platform: "production";
  models: Record<string, PrivateModelAccessEntry>;
}

let cachedPrivateModelAccess: PrivateModelAccessCache | undefined | null;

export function getPrivateModelAccessCachePath(): string {
  return PRIVATE_MODEL_ACCESS_CACHE_PATH;
}

export function clearPrivateModelAccessCache(): void {
  cachedPrivateModelAccess = undefined;
  fs.rmSync(PRIVATE_MODEL_ACCESS_CACHE_PATH, {force: true});
}

export function writePrivateModelAccessCache(cache: PrivateModelAccessCache): void {
  cachedPrivateModelAccess = cache;
  fs.mkdirSync(path.dirname(PRIVATE_MODEL_ACCESS_CACHE_PATH), {recursive: true});
  fs.writeFileSync(
    PRIVATE_MODEL_ACCESS_CACHE_PATH,
    `${JSON.stringify(cache, null, 2)}\n`,
  );
}

export function loadPrivateModelAccessCache(): PrivateModelAccessCache | undefined {
  if (cachedPrivateModelAccess !== undefined) {
    return cachedPrivateModelAccess ?? undefined;
  }

  if (!fs.existsSync(PRIVATE_MODEL_ACCESS_CACHE_PATH)) {
    cachedPrivateModelAccess = null;
    return undefined;
  }

  cachedPrivateModelAccess = JSON.parse(
    fs.readFileSync(PRIVATE_MODEL_ACCESS_CACHE_PATH, "utf8"),
  ) as PrivateModelAccessCache;
  return cachedPrivateModelAccess;
}

function extractSlugFromUrl(urlString?: string): string | undefined {
  if (!urlString) return undefined;

  try {
    return new URL(urlString).searchParams.get("slug") ?? undefined;
  } catch {
    return undefined;
  }
}

export function getScenarioSlug(
  scenario: Pick<ScenarioConfig, "slug" | "customUrl" | "baseUrl">,
  envBaseUrl = process.env.APPBUILDER_BASE_URL?.trim(),
): string | undefined {
  return (
    scenario.slug ??
    extractSlugFromUrl(scenario.customUrl) ??
    extractSlugFromUrl(scenario.baseUrl) ??
    extractSlugFromUrl(envBaseUrl)
  );
}
