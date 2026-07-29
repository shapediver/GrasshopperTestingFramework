# GrasshopperTestingFramework

Testing large, complex Grasshopper definitions can be notoriously difficult. Because components are tightly interconnected, a minor adjustment on one side of a script can easily cause unexpected visual bugs or breaking changes somewhere else downstream.

This repository provides an automated framework for visual regression testing of **Grasshopper** models deployed via the **ShapeDiver App Builder**. By leveraging **Playwright**, this setup opens your AppBuilder app in the browser, interacts with it, and captures screenshots to catch unexpected UI and geometry regressions before they hit production. Designed as a flexible boilerplate, this repository is meant to be forked and customized to fit your specific parametric workflows.

One important feature is that if a baseline screenshot does not exist yet, this repository creates it automatically on the first run. That makes it easier to start testing without extra setup.

## Key Features

- **Initial Load Testing**: Automatically captures and verifies baseline screenshots once your ShapeDiver model finishes loading.

- **Interactive UI Testing**: Simulates real user behavior such as adjusting sliders, toggling parameters, and clicking buttons, then takes follow-up screenshots to ensure geometry and UI update correctly.

- **State Management**: Supports loading specific, pre-configured model states so you can reliably test complex parameter combinations and edge cases.

**Get Started**: Fork this repository, point it at your ShapeDiver App Builder app, and configure your test cases to start safeguarding your Grasshopper workflows against breaking changes.

## Creating a private repository copy

As organization settings do not allow private forks, create an empty private repository first, then push a local clone of this public repository to it.

```bash
# 1. Clone the original public repository locally
git clone https://github.com/shapediver/GrasshopperTestingFramework.git

# 2. Move into the newly created directory
cd GrasshopperTestingFramework

# 3. Rename the public repo remote from "origin" to "upstream"
git remote rename origin upstream

# 4. Link your new empty private repository as the new "origin"
git remote add origin https://github.com/shapediver/GrasshopperTestingFrameworkPrivate.git

# 5. Push all existing branches to your private repository
git push -u origin --all

# 6. Push all tags to your private repository
git push origin --tags
```

### Syncing public changes later

When you want to pull future updates from the public repository into your private repository:

```bash
# 1. Fetch the latest changes from the public repo
git fetch upstream

# 2. Switch to your development branch
git checkout development

# 3. Merge the public updates into your private branch
git merge upstream/development

# 4. Push the updates to your private GitHub repository
git push origin development
```

### Add `upstream` to an existing private copy

If you clone one of your existing private repositories and it does not already
have an `upstream` remote, add the public framework repository like this:

```bash
# Clone your private repository
git clone https://github.com/<your-org>/<your-private-repository>.git
cd <your-private-repository>

# Link the public framework repository as "upstream"
git remote add upstream https://github.com/shapediver/GrasshopperTestingFramework.git
git fetch upstream

# Verify: origin is your private repo; upstream is the public framework repo
git remote -v
```

You can then use the syncing steps above. If your project uses `main` rather
than `development`, merge `upstream/main` instead.

## Files you will usually edit

- `tests/config/scenarios.json` → which slugs and URL parameters to test
- `tests/config/scenarioActions.ts` → what to do in those tests
- `tests/config/README.md` → testing guide with parameter targeting examples and copy-paste templates

## Installation

- Install **Node.js** and **pnpm** once per computer.
- Run `pnpm install` once per copy of this repository.

### 1. Install Node.js

If you do not already have Node.js:

1. Go to: https://nodejs.org/
2. Download the **LTS** version
3. Install it
4. Open a new terminal after the installation finished

### 2. Install pnpm

Run this once:

```bash
npm install -g pnpm
```

### 3. Install this project

Open a terminal in this folder and run:

```bash
pnpm install
```

## Private model access

By default, scenarios are opened through public App Builder URLs using the configured `slug`. To test private models without changing `tests/config/scenarios.json` or `tests/config/scenarioActions.ts`, provide production ShapeDiver platform credentials.

Local setup:

1. Copy `.env.platform-access.example` to `.env.platform-access`.
2. Fill in:
   - `PLATFORM_CLIENT_ID`
   - `PRODUCTION_PLATFORM_ACCESS_TOKEN_KEY`
   - `PRODUCTION_PLATFORM_ACCESS_TOKEN_SECRET`

To get this information, go on the ShapeDiver platform, Settings -> Developers -> PLATFORM BACKEND API ACCESS KEYS -> Create new. The access token needs **Models → Read** permission. For local convenience, the test setup first checks this repository's `.env.platform-access`, then falls back to `.env.platform-access` in your user home folder. CI can provide the same variables directly as environment variables.

When production credentials are present, Playwright global setup fetches `ticket`, `modelViewUrl`, and `accessToken` for every configured scenario slug. The generated cache is written to `tests/config/.private-model-access.json` and is gitignored. Test URLs use the fetched values as query parameters (`ticket`, `modelViewUrl`, `accessToken`) plus `redirect=0`. If any configured slug cannot be resolved with the provided credentials, setup fails fast.

If credentials are absent, the generated cache is removed and tests run through the normal public `?slug=` flow.

## Running tests

### See which tests exist

```bash
pnpm test:list
```

### Run all tests

```bash
pnpm test
```

### Run only screenshot tests

```bash
pnpm test:simple-screenshots
```

### Run only interaction tests

```bash
pnpm test:interaction
```

### Open Playwright UI

```bash
pnpm test:ui
```

### Update screenshots and JSON baselines

If you want to refresh existing screenshots and JSON baselines after an expected change, run:

```bash
pnpm test:update
```

### Update a single scenario

To refresh baselines and snapshots for only one scenario instead of all of them, use:

```bash
pnpm update-scenario <scenario-id>
```

Example:

```bash
pnpm update-scenario barcelona
```

This runs `--update-snapshots` scoped to tests matching the scenario id, so you can iterate on one scenario without re-running every other test.

### Clean all test artifacts

To delete all baselines, snapshots, and reset the scenario configs to a fresh state:

```bash
pnpm clean
```

This removes:

- `tests/snapshots/*.png`
- `tests/baselines/outputs/*.json`
- `tests/baselines/exports/*.json`

And resets:

- `tests/config/scenarios.json` → empty `scenarios: []`
- `tests/config/scenarioActions.ts` → empty `scenarioActions: []`

Use this when starting a new project from the boilerplate or when you want to wipe all test data and begin fresh.

## Adding tests

### 1. Add a slug

Open:

- `tests/config/scenarios.json`

Add a new item inside `scenarios` with an `id` and a `slug`:

```json
{
  "id": "my-app",
  "slug": "my-app-slug"
}
```

`id` is used for snapshot names and to connect a scenario with its interaction test. `slug` is the ShapeDiver model slug used to build the URL.

`id` does not need to be unique. If multiple scenarios reuse the same `id`, all of them run, and they compare against the same snapshot files.

If many scenarios use the same slug, you can define it once in `defaults` and omit it per scenario:

```json
{
  "defaults": {
    "slug": "my-app-slug"
  },
  "scenarios": [
    {
      "id": "my-app"
    }
  ]
}
```

### 2. Optional: add URL parameters

You can also add AppBuilder URL parameters such as:

- `modelStateId`
- `g`
- other query parameters supported by AppBuilder

Example:

```json
{
  "id": "my-app-with-state",
  "slug": "my-app-slug",
  "params": {
    "modelStateId": "12345",
    "g": "theme01.json"
  }
}
```

You can also define shared defaults for all scenarios:

```json
{
  "defaults": {
    "timeoutMs": 90000,
    "slug": "my-app-slug",
    "baseUrl": "https://appbuilder.shapediver.com/v1/main/latest/",
    "params": {
      "g": "./theme01.json"
    }
  },
  "scenarios": [
    {
      "id": "my-app"
    }
  ]
}
```

Scenario-specific `slug`, `baseUrl`, and `params` override the defaults. Local file-like param values such as `./theme01.json` are resolved relative to `tests/config/scenarios.json` and converted to data URLs automatically.

You can also add multiple scenarios with the same slug but different ids and parameters to test different model states.

### Use arrays to test many variations automatically

If a param value is an array, the framework creates one test for each value automatically.

```json
{
  "id": "my-model",
  "slug": "my-model",
  "params": {
    "modelStateId": ["state-a", "state-b", "state-c"]
  }
}
```

This expands to 3 tests: `my-model-state-a`, `my-model-state-b`, `my-model-state-c`.

If you use multiple array params, the framework creates tests for every combination (Cartesian product):

```json
{
  "id": "my-model",
  "slug": "my-model",
  "params": {
    "modelStateId": ["a", "b"],
    "g": ["light.json", "dark.json"]
  }
}
```

This creates 4 tests: `my-model-a-light`, `my-model-a-dark`, `my-model-b-light`, `my-model-b-dark`.

Expanded array-param cases get separate baseline names automatically, for example:

- `my-model-modelStateId-state-a`
- `my-model-modelStateId-state-b`

If you define actions in `tests/config/scenarioActions.ts` with `id: "my-model"`, those actions apply to all expanded cases by default. If you reuse the same `id` across multiple scenarios in separate entries, they intentionally share the same baseline names.

### 3. Add interaction steps

Open:

- `tests/config/scenarioActions.ts`

See **`tests/config/README.md`** for copy-paste templates and parameter targeting examples. Match the `id` to the scenario you added.

This file is where you add real test behavior such as:

- clicking buttons
- uploading files
- downloading files
- typing into inputs
- taking extra screenshots

### 3b. Optional: add output and export baselines

You can also define structured JSON baseline checks directly in `tests/config/scenarios.json`.

Outputs:

```json
{
  "id": "my-output-test",
  "slug": "my-app-slug",
  "outputs": [
    {
      "name": "AppBuilder"
    }
  ]
}
```

Exports:

```json
{
  "id": "my-export-test",
  "slug": "my-app-slug",
  "exports": [
    {
      "name": "Image Export"
    }
  ]
}
```

To baseline every output or export from the main session and all App Builder
instance sessions, use `"all"`. One JSON baseline is created for each category;
its keys include the session and item ids, so same-named items remain distinct.

```json
{
  "id": "my-complete-model-test",
  "slug": "my-app-slug",
  "outputs": "all",
  "exports": "all"
}
```

> Every export is requested during this test and therefore consumes the same
> ShapeDiver export credits as a user-initiated export.
> Exports without downloadable content, such as email exports, are recorded as
> an empty result after their request succeeds.
> Output-all records every output's complete `content` array, including all
> items in multi-item data outputs. For outputs with no data item (for example
> glTF geometry), it removes volatile `href` values recursively before comparison.

If omitted, `session` defaults to `"default"`:

```json
{
  "name": "AppBuilder",
  "session": "default"
}
```

These baselines are stored as JSON in:

- `tests/baselines/outputs/*.json`
- `tests/baselines/exports/*.json`

### 4. Run the tests

```bash
pnpm test:list
pnpm test
```

## Change which AppBuilder version is tested

By default this repo tests:

- `latest`

### Test a specific version

```bash
APPBUILDER_VERSION=development pnpm test
APPBUILDER_VERSION=staging pnpm test
APPBUILDER_VERSION=1.9.5 pnpm test
```

### Test a full custom URL

```bash
APPBUILDER_BASE_URL=https://appbuilder.shapediver.com/v1/main/latest/ pnpm test
```

URL precedence is:

1. `scenario.customUrl`
2. `APPBUILDER_BASE_URL`
3. `defaults.baseUrl`
4. built-in default `https://appbuilder.shapediver.com/v1/main/<version>/`

## Clicking in the 3D scene

Some tests need to click the 3D viewport (canvas) instead of UI elements. Since the 3D scene is a WebGL canvas, you cannot use normal locators like `getByRole`. Instead, use normalized coordinates:

```ts
const pos = await viewportCoords(page, 0.5, 0.75);
await page.mouse.click(pos.x, pos.y);
```

The value `0.5` = half the canvas width, `0.75` = three quarters down.

### Coordinate picker tool

This repo includes a tool that opens your app and prints the coordinates wherever you click:

```bash
pnpm pick-coords <scenario-id>
```

If the same `id` matches multiple scenarios, `pick-coords` cannot know which one you mean. In that case, temporarily make the target one unique before running the tool.

Example:

```bash
pnpm pick-coords beta-cameraaction
```

1. The browser opens and loads the app
2. Click anywhere on the 3D scene
3. Normalized coordinates appear in the terminal:

```
viewportCoords(page, 0.320, 0.480)
```

4. Paste that line directly into your `scenarioActions.ts` file
5. Close the browser when you are done
