import { expect, test } from "@playwright/test";

test.describe("mail client regression", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/mail");
    await expect(page.getByTestId("account-e2e-regression@smartmail.test")).toBeVisible();
    await page.getByTestId("account-e2e-regression@smartmail.test").click();
  });

  test("shows needs reply thread in the inbox reader", async ({ page }) => {
    await expect(page.getByTestId("workspace-nav-inbox")).toHaveClass(/active/);
    await expect(page.getByTestId("reader-subject")).toContainText("Website launch decision");
    await expect(page.getByTestId("draft-pad")).toContainText("Thanks for the note");
  });

  test("switches to follow-ups and opens the waiting thread", async ({ page }) => {
    await page.getByTestId("workspace-nav-followups").click();
    await expect(page.getByTestId("followup-list")).toBeVisible();
    await expect(page.getByTestId("reader-subject")).toContainText("Resident portal rollout");
  });

  test("switches mailboxes and loads the team inbox thread", async ({ page }) => {
    await page.getByRole("button", { name: /Razz Team Inbox/i }).click();
    await expect(page.getByTestId("reader-subject")).toContainText("Brand review feedback");
  });

  test("shows account grouping in the accounts workspace", async ({ page }) => {
    await page.getByTestId("workspace-nav-accounts").click();
    await expect(page.getByTestId("accounts-list")).toBeVisible();
    await page.getByRole("button", { name: /Northshore/i }).click();
    await expect(page.getByTestId("organization-title")).toContainText("Northshore");
  });
});
