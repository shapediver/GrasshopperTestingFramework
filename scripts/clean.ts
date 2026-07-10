/**
 * Clean script: deletes all baselines, snapshots, and resets
 * scenarios / scenarioActions to their minimal defaults.
 *
 * Usage:
 *   pnpm clean
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");

const SNAPSHOTS_DIR = path.join(ROOT, "tests", "snapshots");
const BASELINES_OUTPUTS_DIR = path.join(ROOT, "tests", "baselines", "outputs");
const BASELINES_EXPORTS_DIR = path.join(ROOT, "tests", "baselines", "exports");
const SCENARIOS_PATH = path.join(ROOT, "tests", "config", "scenarios.json");
const ACTIONS_PATH = path.join(ROOT, "tests", "config", "scenarioActions.ts");

const DEFAULT_SCENARIOS = JSON.stringify(
  {
    defaults: {
      timeoutMs: 90000,
    },
    scenarios: [],
  },
  null,
  2,
) + "\n";

const DEFAULT_ACTIONS = `import { Page } from "@playwright/test";

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

export const scenarioActions: ScenarioActionConfig[] = [];

export const scenarioActionById = new Map(
  scenarioActions.map((config) => [config.id, config]),
);
`;

function cleanDir(dir: string, label: string) {
  if (!fs.existsSync(dir)) {
    console.log(`  [skip] ${label}: directory does not exist`);
    return;
  }

  const files = fs.readdirSync(dir);
  if (files.length === 0) {
    console.log(`  [skip] ${label}: already empty`);
    return;
  }

  for (const file of files) {
    fs.rmSync(path.join(dir, file), { recursive: true });
  }
  console.log(`  [ok]   ${label}: removed ${files.length} file(s)`);
}

function writeFile(filePath: string, content: string, label: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log(`  [ok]   ${label}: reset to defaults`);
}

function main() {
  console.log("Cleaning test artifacts and resetting configs...\n");

  cleanDir(SNAPSHOTS_DIR, "snapshots");
  cleanDir(BASELINES_OUTPUTS_DIR, "baselines/outputs");
  cleanDir(BASELINES_EXPORTS_DIR, "baselines/exports");

  writeFile(SCENARIOS_PATH, DEFAULT_SCENARIOS, "scenarios.json");
  writeFile(ACTIONS_PATH, DEFAULT_ACTIONS, "scenarioActions.ts");

  console.log("\nDone.");
}

main();
