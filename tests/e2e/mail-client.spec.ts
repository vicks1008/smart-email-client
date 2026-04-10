import { expect, test, type Page } from "@playwright/test";

async function openThread(page: Page, subject: string) {
  await expect(page.locator("[data-testid^='thread-row-']")).toHaveCount(2, { timeout: 15_000 });

  const targetThread = page.locator("[data-testid^='thread-row-']").filter({ hasText: subject }).first();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await targetThread.click();

    try {
      await expect(page.getByTestId("reader-pane")).toContainText(subject, { timeout: 10_000 });
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
    }
  }
}

test.describe("mail client regression", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/mail");
    await expect(page.getByTestId("thread-list")).toBeVisible();
  });

  test("shows needs reply thread in the inbox reader", async ({ page }) => {
    await openThread(page, "Website launch decision");
    await expect(page.getByTestId("workspace-nav-inbox")).toHaveClass(/active/);
    await expect(page.getByTestId("reader-subject")).toContainText("Website launch decision");
    await expect(page.getByTestId("draft-pad")).toContainText("Thanks for the note");
  });

  test("switches to follow-ups and opens the waiting thread", async ({ page }) => {
    await page.getByTestId("workspace-nav-followups").click();
    await expect(page.getByTestId("followup-list")).toBeVisible();
    await page.getByRole("button", { name: /Resident portal rollout/i }).click();
    await expect(page.getByTestId("reader-subject")).toContainText("Resident portal rollout");
  });

  test("switches mailboxes and loads the team inbox thread", async ({ page }) => {
    await page.getByTestId("workspace-nav-accounts").click();
    await expect(page.getByTestId("account-e2e-regression@smartmail.test")).toBeVisible();
    await page.getByTestId("account-e2e-regression@smartmail.test").click();
    await page.getByRole("button", { name: /Razz Team Inbox/i }).click();
    await expect(page.getByTestId("reader-subject")).toContainText("Brand review feedback");
  });

  test("shows account grouping in the accounts workspace", async ({ page }) => {
    await page.getByTestId("workspace-nav-accounts").click();
    await expect(page.getByTestId("accounts-list")).toBeVisible();
    await page.getByRole("button", { name: /Northshore/i }).click();
    await expect(page.getByTestId("organization-title")).toContainText("Northshore");
  });

  test("loads the assistant workbench and applies a generated draft", async ({ page }) => {
    await openThread(page, "Website launch decision");
    await expect(page.getByTestId("assistant-workbench")).toBeVisible();
    await page.getByTestId("assistant-workbench").getByRole("button", { name: /Concise reply/i }).click();
    await expect(page.getByTestId("draft-pad")).toContainText("Hi Amanda");
  });

  test("supports shared mailbox filtering and command palette navigation", async ({ page, browserName }) => {
    await page.getByRole("button", { name: "Shared" }).click();
    await expect(page.getByTestId("reader-subject")).toContainText("Brand review feedback");

    if (browserName === "webkit") {
      await page.keyboard.press("Meta+J");
    } else {
      await page.keyboard.press("Control+J");
    }

    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByPlaceholder("Jump to a workspace, action, or settings page").fill("open settings models");
    await page.getByRole("button", { name: /Open Settings: Models/i }).click();
    await expect(page).toHaveURL(/\/settings\/models$/);
    await expect(page.getByText("Model source for enrichment")).toBeVisible();
  });

  test("persists model settings after reload", async ({ page }) => {
    await page.goto("/settings/models");
    await page.getByRole("button", { name: /Cloud API token/i }).click();
    await page.getByLabel("Default model").fill("gpt-5.4");
    await page.getByRole("button", { name: /Save changes/i }).click();
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(page.getByText("Model source for enrichment")).toBeVisible();
    await expect(page.getByLabel("Default model")).toHaveValue("gpt-5.4");
  });
});
