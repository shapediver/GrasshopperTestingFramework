import {Page} from "@playwright/test";

/**
 * Waits for ShapeDiver's `session.customized` event after an interaction.
 */
export async function waitForModelRecomputed(
  page: Page,
  action: () => Promise<void>,
  timeout = 90_000,
): Promise<void> {
  await page.evaluate(() => {
    (window as any).__sdvSessionCustomized = false;
    const SDV = (window as any).SDV;
    const token = SDV.addListener("session.customized", () => {
      (window as any).__sdvSessionCustomized = true;
      SDV.removeListener(token);
    });
  });

  await action();

  await page.waitForFunction(
    () => (window as any).__sdvSessionCustomized === true,
    {timeout},
  );

  await page.evaluate(() => {
    delete (window as any).__sdvSessionCustomized;
  });
}
