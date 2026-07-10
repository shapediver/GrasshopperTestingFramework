import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import dotenv from "dotenv";
import {
  SdPlatformModelGetEmbeddableFields,
  create as createSdk,
} from "@shapediver/sdk.platform-api-sdk-v1";
import {loadScenarios} from "./helpers/loadScenarios";
import {
  clearPrivateModelAccessCache,
  getPrivateModelAccessCachePath,
  getScenarioSlug,
  type PrivateModelAccessEntry,
  writePrivateModelAccessCache,
} from "./helpers/privateModelAccess";

const PLATFORM_BASE_URL = "https://app.shapediver.com";
const LOCAL_ENV_FILE = path.resolve(".env.platform-access");
const USER_ENV_FILE = path.join(os.homedir(), ".env.platform-access");

type EnvFile = Record<string, string>;

function readEnvFile(filePath: string): EnvFile {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
}

function getEnvValue(
  name: string,
  localEnv: EnvFile,
  userEnv: EnvFile,
): string | undefined {
  return [process.env[name], localEnv[name], userEnv[name]].find(
    (value) => !!value?.trim(),
  );
}

function getProductionCredentials():
  | {
      clientId: string;
      accessTokenKey: string;
      accessTokenSecret: string;
    }
  | undefined {
  const localEnv = readEnvFile(LOCAL_ENV_FILE);
  const userEnv = readEnvFile(USER_ENV_FILE);

  const clientId = getEnvValue("PLATFORM_CLIENT_ID", localEnv, userEnv);
  const accessTokenKey = getEnvValue(
    "PRODUCTION_PLATFORM_ACCESS_TOKEN_KEY",
    localEnv,
    userEnv,
  );
  const accessTokenSecret = getEnvValue(
    "PRODUCTION_PLATFORM_ACCESS_TOKEN_SECRET",
    localEnv,
    userEnv,
  );

  const hasAnyProductionCredential = !!accessTokenKey || !!accessTokenSecret;
  if (!hasAnyProductionCredential) return undefined;

  const missing = [
    ["PLATFORM_CLIENT_ID", clientId],
    ["PRODUCTION_PLATFORM_ACCESS_TOKEN_KEY", accessTokenKey],
    ["PRODUCTION_PLATFORM_ACCESS_TOKEN_SECRET", accessTokenSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `[global-setup] Incomplete production platform access credentials. Missing: ${missing.join(
        ", ",
      )}. Provide them in environment variables, ${LOCAL_ENV_FILE}, or ${USER_ENV_FILE}.`,
    );
  }

  return {
    clientId: clientId!,
    accessTokenKey: accessTokenKey!,
    accessTokenSecret: accessTokenSecret!,
  };
}

function collectScenarioSlugs(): string[] {
  const {scenarios} = loadScenarios();
  const slugs = new Set<string>();

  for (const scenario of scenarios) {
    const slug = getScenarioSlug(scenario);
    if (!slug) {
      throw new Error(
        `[global-setup] Scenario "${scenario.id}" does not have a concrete slug. Private model access requires scenario.slug, defaults.slug, or a URL containing ?slug=.`,
      );
    }
    slugs.add(slug);
  }

  return [...slugs].sort((a, b) => a.localeCompare(b));
}

async function fetchPrivateModelAccessEntries(
  slugs: string[],
  credentials: NonNullable<ReturnType<typeof getProductionCredentials>>,
): Promise<Record<string, PrivateModelAccessEntry>> {
  const client = createSdk({
    clientId: credentials.clientId,
    baseUrl: PLATFORM_BASE_URL,
  });

  await client.authorization.passwordGrant(
    credentials.accessTokenKey,
    credentials.accessTokenSecret,
  );

  const entries: Record<string, PrivateModelAccessEntry> = {};

  await Promise.all(
    slugs.map(async (slug) => {
      const response = await client.models.get(slug, [
        SdPlatformModelGetEmbeddableFields.BackendSystem,
        SdPlatformModelGetEmbeddableFields.Ticket,
        SdPlatformModelGetEmbeddableFields.TokenExportFallback,
      ]);
      const model = response.data;
      const ticket = model.ticket?.ticket;
      const modelViewUrl = model.backend_system?.model_view_url;
      const accessToken = model.access_token;

      const missing = [
        ["ticket.ticket", ticket],
        ["backend_system.model_view_url", modelViewUrl],
        ["access_token", accessToken],
      ]
        .filter(([, value]) => !value)
        .map(([name]) => name);

      if (missing.length > 0) {
        throw new Error(
          `[global-setup] Model "${slug}" was fetched from production, but required private access fields are missing: ${missing.join(
            ", ",
          )}.`,
        );
      }

      entries[slug] = {
        slug,
        ticket: ticket!,
        modelViewUrl: modelViewUrl!,
        accessToken: accessToken!,
      };
    }),
  );

  return entries;
}

export default async function globalSetup() {
  const credentials = getProductionCredentials();

  if (!credentials) {
    clearPrivateModelAccessCache();
    console.log(
      `[global-setup] No production platform access credentials found. Running scenarios through their public App Builder URLs.`,
    );
    return;
  }

  const slugs = collectScenarioSlugs();
  const models = await fetchPrivateModelAccessEntries(slugs, credentials);

  writePrivateModelAccessCache({
    version: 1,
    generatedAt: new Date().toISOString(),
    platform: "production",
    models,
  });

  console.log(
    `[global-setup] Wrote private model access cache for ${slugs.length} slug(s): ${getPrivateModelAccessCachePath()}`,
  );
}
