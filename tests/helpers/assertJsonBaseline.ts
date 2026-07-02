import {expect} from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

function isUpdateSnapshotsMode(): boolean {
  return process.argv.includes("--update-snapshots") || process.argv.includes("-u");
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nestedValue]) => [key, stableNormalize(nestedValue)]),
    );
  }

  return value;
}

export async function assertJsonBaseline(name: string, actualValue: unknown) {
  const baselinePath = path.resolve(`tests/baselines/${name}.json`);
  const normalized = stableNormalize(actualValue);
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  const baselineExists = fs.existsSync(baselinePath);
  const shouldUpdate = isUpdateSnapshotsMode();

  if (!baselineExists || shouldUpdate) {
    fs.mkdirSync(path.dirname(baselinePath), {recursive: true});
    fs.writeFileSync(baselinePath, serialized);
    console.log(
      `[assertJsonBaseline] ${baselineExists && shouldUpdate ? "Updated" : "Created new"} baseline: ${baselinePath}`,
    );
    return;
  }

  const expected = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  expect(normalized).toEqual(expected);
}
