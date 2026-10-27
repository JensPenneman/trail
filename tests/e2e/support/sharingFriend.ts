import { expect } from "@playwright/test";
import { deviceWithCredentialsResponseSchema } from "@trail/contracts/device";
import { type OutgoingShare, shareResponseSchema } from "@trail/contracts/share";
import type { SessionUser } from "@trail/contracts/user";
import { overlandBatch } from "./overlandBatch";
import { postOverland } from "./postOverland";
import { signUp } from "./signUp";
import type { OtherBrowser } from "./test";
import { uniqueEmail } from "./uniqueEmail";

/** Someone else, in a browser of their own, who shares their location with the test's account. */
export interface SharingFriend {
  browser: OtherBrowser;
  account: SessionUser;
  share: OutgoingShare;
  /** Their phone, which has uploaded today's fixture. */
  device: { name: string; token: string };
  /** For their own mutations (the API checks the origin of a signed-in request). */
  origin: string;
}

/**
 * Signs someone up in another browser, gives them a phone that has uploaded
 * today's fixture (through the API: the add-device flow has specs of its own)
 * and has them share it with `recipient` as `share` says, until stopped.
 */
export async function sharingFriend(
  openBrowser: () => Promise<OtherBrowser>,
  recipient: SessionUser,
  label: string,
  share: { precision: "precise" | "approximate" | "area"; historyDays: number | null },
): Promise<SharingFriend> {
  const browser = await openBrowser();
  const account = await signUp(browser.page, uniqueEmail(label));
  const origin = new URL(browser.page.url()).origin;
  const name = `${label}’s phone`;
  const created = await browser.page.request.post("/api/devices", {
    data: { name },
    headers: { Origin: origin },
  });
  expect(created.status()).toBe(201);
  const { credentials } = deviceWithCredentialsResponseSchema.parse(await created.json());
  const uploaded = await postOverland(
    browser.page.request,
    credentials.accessToken,
    overlandBatch(account.timezone),
  );
  expect(uploaded.status()).toBe(200);
  const shared = await browser.page.request.post("/api/v1/shares", {
    data: { email: recipient.email, duration: "indefinitely", ...share },
    headers: { Origin: origin },
  });
  expect(shared.status()).toBe(201);
  // Their own page is not under test: a blank one leaves the machine to the one that is.
  await browser.page.goto("about:blank");
  return {
    browser,
    account,
    share: shareResponseSchema.parse(await shared.json()).share,
    device: { name, token: credentials.accessToken },
    origin,
  };
}
