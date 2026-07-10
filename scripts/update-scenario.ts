/**
 * Update a single scenario: runs the given scenario id with --update-snapshots
 * so that baselines and snapshots for only that scenario are refreshed.
 *
 * Usage:
 *   pnpm update-scenario <scenario-id>
 *   pnpm update-scenario barcelona
 */

import { execSync } from "child_process";
import { loadScenarios } from "../tests/helpers/loadScenarios.js";

function main() {
  const scenarioId = process.argv[2];

  if (!scenarioId) {
    console.error("");
    console.error("  Usage: pnpm update-scenario <scenario-id>");
    console.error("  Example: pnpm update-scenario barcelona");
    console.error("");
    process.exit(1);
  }

  const { scenarios } = loadScenarios();
  const matches = scenarios.filter((s) => s.id === scenarioId);

  if (matches.length === 0) {
    console.error(`\n  No scenario found with id "${scenarioId}".\n`);
    process.exit(1);
  }

  console.log(
    `\n  Updating ${matches.length} scenario(s) matching "${scenarioId}"...\n`,
  );

  try {
    execSync(
      `npx playwright test --grep "${scenarioId}" --update-snapshots`,
      { stdio: "inherit", cwd: process.cwd() },
    );
  } catch {
    // Playwright returns non-zero on test failures; suppress for update runs.
  }

  console.log(`\n  Done. Updated snapshots and baselines for "${scenarioId}".\n`);
}

main();
