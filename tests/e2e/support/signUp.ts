import { expect, type Page } from "@playwright/test";
import { type SessionUser, sessionResponseSchema } from "@trail/contracts/user";

/** What the sign-up ceremony may take before the People page shows. */
const ceremonyMs = 40_000;

/**
 * Creates an account the way a person does: the email address on the sign-in
 * page, Continue, and a new passkey from the page's authenticator. Ends on the
 * People page (home), signed in.
 */
export async function signUp(page: Page, email: string): Promise<SessionUser> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  // Continue is a ceremony of several round trips (the passkey's options, the authenticator's
  // answer, the server's check, a session) and then the People page's first load with its map:
  // the 10 s of an ordinary assertion is too little on a busy machine, and nothing else shows
  // that it is done. It is awaited for what it is, within the test's own 60 s.
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible({
    timeout: ceremonyMs,
  });
  return currentUser(page);
}

/** The account the page is signed in to, as the API describes it. */
export async function currentUser(page: Page): Promise<SessionUser> {
  const response = await page.request.get("/api/auth/session");
  expect(response.status()).toBe(200);
  return sessionResponseSchema.parse(await response.json()).user;
}
