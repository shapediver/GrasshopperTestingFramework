import {Page} from "@playwright/test";

/**
 * Converts normalised (0-1) viewport coordinates into page coordinates.
 */
export async function viewportCoords(
  page: Page,
  x: number,
  y: number,
): Promise<{x: number; y: number}> {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("Canvas not found or has no bounding box");
  return {
    x: box.x + box.width * x,
    y: box.y + box.height * y,
  };
}
