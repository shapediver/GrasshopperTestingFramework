import {Locator, Page} from "@playwright/test";

/**
 * Finds an AppBuilder parameter block by its visible label text.
 */
export function getParameterElement(page: Page, displayName: string): Locator {
  return page.locator("p", {hasText: displayName}).locator("../..");
}
