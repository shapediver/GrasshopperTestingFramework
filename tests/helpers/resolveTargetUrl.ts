import * as fs from "fs";
import * as path from "path";
import {ScenarioConfig, ScenarioUrlParams, getScenarioConfigPath} from "./loadScenarios";

const DEFAULT_HOST = "https://appbuilder.shapediver.com/v1/main";
const DEFAULT_VERSION = "latest";

function getDefaultBaseUrl(): string {
  const envVersion = process.env.APPBUILDER_VERSION?.trim();
  const version = envVersion || DEFAULT_VERSION;
  return `${DEFAULT_HOST}/${version}/`;
}

function looksLikeLocalFilePath(value: string): boolean {
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\") ||
    path.isAbsolute(value)
  );
}

function guessMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".glb":
      return "model/gltf-binary";
    case ".gltf":
      return "model/gltf+json";
    default:
      return "application/octet-stream";
  }
}

function resolveScenarioParamValue(value: string): string {
  if (!looksLikeLocalFilePath(value)) return value;

  const scenarioDir = path.dirname(getScenarioConfigPath());
  const absolutePath = path.isAbsolute(value)
    ? value
    : path.resolve(scenarioDir, value);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Local param file not found: ${value} (resolved to ${absolutePath})`,
    );
  }

  const content = fs.readFileSync(absolutePath);
  const mimeType = guessMimeType(absolutePath);
  return `data:${mimeType};base64,${content.toString("base64")}`;
}

function applyParams(url: URL, params?: ScenarioUrlParams) {
  if (!params) return;

  for (const [key, value] of Object.entries(params)) {
    const resolvedValue =
      typeof value === "string" ? resolveScenarioParamValue(value) : value;
    url.searchParams.set(key, String(resolvedValue));
  }
}

export function resolveTargetUrl(scenario: ScenarioConfig): string {
  const envBaseUrl = process.env.APPBUILDER_BASE_URL?.trim();
  const baseUrl =
    scenario.customUrl ||
    envBaseUrl ||
    scenario.baseUrl ||
    getDefaultBaseUrl();
  const url = new URL(baseUrl);

  if (!url.searchParams.has("slug")) {
    if (!scenario.slug) {
      throw new Error(
        `Scenario "${scenario.id}" could not resolve a slug. Provide scenario.slug, defaults.slug, or a URL that already contains ?slug=.`,
      );
    }

    url.searchParams.set("slug", scenario.slug);
  }

  applyParams(url, scenario.params as ScenarioUrlParams | undefined);

  return url.toString();
}
