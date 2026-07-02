# GrasshopperTestingFramework

Testing large, complex Grasshopper definitions can be notoriously difficult. Because components are tightly interconnected, a minor adjustment on one side of a script can easily cause unexpected visual bugs or breaking changes somewhere else downstream.

This repository provides an automated framework for visual regression testing of **Grasshopper** models deployed via the **ShapeDiver App Builder**. By leveraging **Playwright**, this setup opens your AppBuilder app in the browser, interacts with it, and captures screenshots to catch unexpected UI and geometry regressions before they hit production. Designed as a flexible boilerplate, this repository is meant to be forked and customized to fit your specific parametric workflows.

One important feature is that if a baseline screenshot does not exist yet, this repository creates it automatically on the first run. That makes it easier to start testing without extra setup.

## Key Features

- **Initial Load Testing**: Automatically captures and verifies baseline screenshots once your ShapeDiver model finishes loading.

- **Interactive UI Testing**: Simulates real user behavior such as adjusting sliders, toggling parameters, and clicking buttons, then takes follow-up screenshots to ensure geometry and UI update correctly.

- **State Management**: Supports loading specific, pre-configured model states so you can reliably test complex parameter combinations and edge cases.

**Get Started**: Fork this repository, point it at your ShapeDiver App Builder app, and configure your test cases to start safeguarding your Grasshopper workflows against breaking changes.

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

For compatibility, this also works:

```bash
pnpm test:update-snapshots
```

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
