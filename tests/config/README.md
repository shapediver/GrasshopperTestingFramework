# App Builder Testing Guide

This guide covers how to target parameters by their on-screen labels and provides copy-paste templates for writing automated tests.

---

## 🔍 How to Target Typical App Builder Parameters

The helpers below let you find any parameter by its on-screen label. Every step uses `await` to tell the test to "wait for this to finish before moving to the next line". Always leave `await` in front of every action.

### 🎚️ Slider

Find the parameter by label, then change its number textbox. The slider itself has no text label, but the number next to it does.

```typescript
const blockSizeSlider = getParameterElement(page, "Block Size").getByRole(
  "textbox",
);
await waitForModelRecomputed(page, async () => {
  await blockSizeSlider.fill("0.8");
  await blockSizeSlider.press("Enter");
});
```

### 🔤 Text Input

Same approach as the slider: find the parameter, fill the textbox, and press Enter.

```typescript
const textInput = getParameterElement(page, "Label").getByRole("textbox");
await waitForModelRecomputed(page, async () => {
  await textInput.fill("New Value");
  await textInput.press("Enter");
});
```

### 🔽 Dropdown / Select

Click the textbox to open the list, then click the option you want.

```typescript
const materialDropdown = getParameterElement(page, "Material").getByRole(
  "textbox",
);

await materialDropdown.click();
await waitForModelRecomputed(page, async () => {
  await page.getByRole("option", { name: "Wood" }).click();
});
```

### 🔘 Activation Button (Selection / Gumball / Points Input)

Find the parameter by label, then click its button to activate it.

```typescript
const selectBoxButton = getParameterElement(page, "SelectBox").getByRole(
  "button",
);
await selectBoxButton.click();
```

### 📁 File Input

Use with `setup` block; this runs before the model loads.

```typescript
const floorPlanInput = getParameterElement(page, "Floor Plan").locator(
  'input[type="file"]',
);
await floorPlanInput.setInputFiles("path/to/your-file.3dm");
```

### ⚡ Action Button

Fires a Grasshopper script immediately.

```typescript
const runScriptButton = page.getByRole("button", { name: "Run Script" });
await runScriptButton.click();
```

### 📑 Tabs

```typescript
const editBlocksTab = page.getByRole("tab", { name: "Edit Blocks" });
await editBlocksTab.click();
```

---

## ⚠️ Two Important Rules

### 1. Everything needs `await` in front

`await` means: "wait until this step is done, then continue." If you forget `await`, the test will probably break.

### 2. Some actions need `waitForModelRecomputed`, some don't

`waitForModelRecomputed` means: "do this action, then wait for the 3D model to finish recalculating before taking a screenshot."

| Use `waitForModelRecomputed` when:          | You do **NOT** need it when:               |
| :------------------------------------------ | :----------------------------------------- |
| Changing a slider, textbox, or dropdown     | Switching tabs                             |
| Clicking a button that changes the 3D model | Clicking a button that only opens a panel  |
| Clicking inside the 3D scene                | The action does not change the 3D geometry |

---

## 📋 Copy-Paste Templates

Each template is a complete block you can copy. Change the names and coordinates to match your app.

If a scenario expands into multiple cases because one or more params use arrays, an action registered for the base id (for example `my-app`) is reused for all expanded cases. Expanded array-param cases get separate baseline names automatically. Reusing the same `id` across multiple scenarios is also allowed, and those scenarios compare against the same baseline files.

### 1. Tab Click + Screenshot

No `waitForModelRecomputed` needed — tabs only change the UI, not the model.

```typescript
{
  id: "my-app",
  actions: async (page, scenarioId) => {
    // Click the tab
    await page.getByRole("tab", { name: "Edit Blocks" }).click();
    // Take a screenshot
    await takeSnapshot(page, `${scenarioId}-after-tab`);
  },
}
```

### 2. Click in the 3D Scene + Screenshot

First find the right coordinates with: `pnpm pick-coords <scenario-id>`. The 3D scene click changes the model, so wrap it in `waitForModelRecomputed`.

```typescript
{
  id: "my-app",
  actions: async (page, scenarioId) => {
    // Convert (0.144, 0.302) screen position to pixel coordinates
    const coords = await viewportCoords(page, 0.144, 0.302);
    // Click there and wait for the 3D model
    await waitForModelRecomputed(page, async () => {
      await page.mouse.click(coords.x, coords.y);
    });
    // Take a screenshot
    await takeSnapshot(page, `${scenarioId}-after-click`);
  },
}
```

### 3. Slider Change + Screenshot

Find the slider by label, type a new value into its textbox, and press Enter. Wrap in `waitForModelRecomputed` because the model recalculates.

```typescript
{
  id: "my-app",
  actions: async (page, scenarioId) => {
    // Find slider by its on-screen name, then get the number textbox
    const slider = getParameterElement(page, "Block Size").getByRole("textbox");
    // Type a new value and wait for the model
    await waitForModelRecomputed(page, async () => {
      await slider.fill("0.8");
      await slider.press("Enter");
    });
    // Take a screenshot
    await takeSnapshot(page, `${scenarioId}-slider-changed`);
  },
}
```

### 4. File Upload (BEFORE the app is ready)

This uses `setup` instead of `actions` because the file must be uploaded before the model can start loading.

```typescript
{
  id: "my-app",
  setup: async (page) => {
    // Find the file input parameter and upload a file
    const fileInput = getParameterElement(page, "Floor Plan").locator('input[type="file"]');
    await fileInput.setInputFiles("path/to/your-file.3dm");
  },
}
```

### 5. Download Test

Set up a listener **before** clicking, then check the filename. No `waitForModelRecomputed` needed — downloads don't change the model.

```typescript
{
  id: "my-app",
  actions: async (page) => {
    // Start listening for a download
    const downloadPromise = page.waitForEvent("download");
    // Click the download button
    const downloadButton = page.getByRole("button", { name: "Download File" });
    await downloadButton.click();
    // Wait for the download to start
    const download = await downloadPromise;
    // Check that the filename has the right ending
    expect(download.suggestedFilename()).toMatch(/\.(3dm|obj|stl|step|iges)$/i);
  },
}
```

### 6. Output and export baselines in `scenarios.json`

```json
{
  "id": "my-output-test",
  "slug": "my-app-slug",
  "outputs": [
    {
      "name": "AppBuilder"
    }
  ],
  "exports": [
    {
      "name": "Image Export"
    }
  ]
}
```

- `session` is optional and defaults to `"default"`
- output baselines are stored under `tests/baselines/outputs/`
- export baselines are stored under `tests/baselines/exports/`
- export comparisons ignore all `href` properties recursively

To test all outputs or exports from the main session and every App Builder
instance session, replace either list with `"all"`:

```json
{
  "id": "my-complete-model-test",
  "slug": "my-app-slug",
  "outputs": "all",
  "exports": "all"
}
```

All items in a category are stored in one baseline. Export-all requests every
export, so it consumes the corresponding ShapeDiver export credits. Successful
exports with no downloadable content (such as email exports) are stored as an
empty result. Output-all records every output's complete `content` array,
including all items in multi-item data outputs. For outputs with no data item
(such as glTF geometry), volatile `href` values are removed recursively before
comparison.

### 7. Shared defaults in `scenarios.json`

```json
{
  "defaults": {
    "slug": "my-app-slug",
    "baseUrl": "https://appbuilder.shapediver.com/v1/main/latest/",
    "params": {
      "g": "./theme.json"
    }
  },
  "scenarios": [
    {
      "id": "my-app"
    },
    {
      "id": "my-app-with-state",
      "params": {
        "modelStateId": ["state-a", "state-b"]
      }
    }
  ]
}
```

- `defaults.slug` lets scenarios omit `slug`
- `defaults.baseUrl` sets a project-level default App Builder URL
- relative file values like `./theme.json` are resolved relative to `tests/config/scenarios.json` and converted to data URLs automatically
- the action with `id: "my-app-with-state"` will run for both expanded cases
- if you add another scenario with the same `id`, it will also run and reuse the same snapshot names
