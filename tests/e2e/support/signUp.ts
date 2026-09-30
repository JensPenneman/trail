import { expect, type Page } from "@playwright/test";
import { type SessionUser, sessionResponseSchema } from "@trail/contracts/user";

/**
 * Creates an account the way a person does: the email address on the sign-in
 * page, Continue, and a new passkey from the page's authenticator. Ends on the
 * Live page, signed in.
 */
export async function signUp(page: Page, email: string): Promise<SessionUser> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Live" })).toBeVisible();
  return currentUser(page);
}

/** The account the page is signed in to, as the API describes it. */
export async function currentUser(page: Page): Promise<SessionUser> {
  const response = await page.request.get("/api/auth/session");
  expect(response.status()).toBe(200);
  return sessionResponseSchema.parse(await response.json()).user;
}
