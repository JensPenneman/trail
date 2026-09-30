import {
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { SessionUser } from "@trail/contracts/user";
import { ConsoleGuard } from "./consoleGuard";
import { stubMapStyles } from "./mapStyleStub";
import { signUp } from "./signUp";
import { uniqueEmail } from "./uniqueEmail";
import { VirtualAuthenticator } from "./virtualAuthenticator";

/** Another browser: a second person, or the same person on another device. */
export interface OtherBrowser {
  context: BrowserContext;
  page: Page;
  authenticator: VirtualAuthenticator;
}

interface Fixtures {
  /**
   * Whether the browser offers saved passkeys in the email field's autofill
   * (conditional mediation). Chromium's virtual authenticator answers such a
   * request at once, so with it on the sign-in page signs in by itself whenever
   * the authenticator holds a passkey — tests of the other ways turn it off.
   */
  passkeyAutofill: boolean;
  /** Fails the test on console errors, uncaught exceptions and CSP violations in any of its pages. */
  consoleGuard: ConsoleGuard;
  /** The platform authenticator of `page` (Chromium only). */
  authenticator: VirtualAuthenticator;
  /** A new account, signed up on `page` — which is signed in afterwards. */
  account: SessionUser;
  /** Opens another browser with the same device settings, watched like `page`. */
  openBrowser: (options?: { storageState?: string }) => Promise<OtherBrowser>;
}

/** Guard, map stub and autofill setting for every context a test uses. */
async function prepare(
  context: BrowserContext,
  input: { guard: ConsoleGuard; passkeyAutofill: boolean; appOrigin: string },
): Promise<void> {
  await input.guard.watch(context);
  await stubMapStyles(context, input.appOrigin);
  if (!input.passkeyAutofill) {
    await context.addInitScript(() => {
      // Only secure pages have WebAuthn (a new tab's about:blank does not).
      if (typeof PublicKeyCredential === "undefined") return;
      Object.defineProperty(PublicKeyCredential, "isConditionalMediationAvailable", {
        configurable: true,
        value: () => Promise.resolve(false),
      });
    });
  }
}

/** The project's device (viewport, user agent, touch …) for a context the test opens itself. */
function projectContextOptions(testInfo: TestInfo): BrowserContextOptions {
  const {
    baseURL,
    locale,
    timezoneId,
    viewport,
    userAgent,
    isMobile,
    hasTouch,
    deviceScaleFactor,
  } = testInfo.project.use;
  return {
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(locale === undefined ? {} : { locale }),
    ...(timezoneId === undefined ? {} : { timezoneId }),
    ...(viewport === undefined ? {} : { viewport }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(isMobile === undefined ? {} : { isMobile }),
    ...(hasTouch === undefined ? {} : { hasTouch }),
    ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
  };
}

const appOriginOf = (baseURL: string | undefined): string => {
  if (baseURL === undefined) throw new Error("playwright.config.ts sets no baseURL");
  return new URL(baseURL).origin;
};

/** The suite's `test`: Playwright's, with the fixtures above. */
export const test = base.extend<Fixtures>({
  passkeyAutofill: [true, { option: true }],

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures always take the fixture object
  consoleGuard: async ({}, use) => {
    const guard = new ConsoleGuard();
    await use(guard);
    expect(guard.problems(), "console errors, uncaught exceptions or CSP violations").toEqual([]);
  },

  context: async ({ context, consoleGuard, passkeyAutofill, baseURL }, use) => {
    await prepare(context, {
      guard: consoleGuard,
      passkeyAutofill,
      appOrigin: appOriginOf(baseURL),
    });
    await use(context);
  },

  authenticator: async ({ page, browserName }, use) => {
    if (browserName !== "chromium") {
      throw new Error(
        "Passkey tests need Chromium's virtual authenticator; tag them out of WebKit",
      );
    }
    await use(await VirtualAuthenticator.attach(page));
  },

  account: async ({ page, authenticator }, use, testInfo) => {
    const label = testInfo.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24);
    const user = await signUp(page, uniqueEmail(label));
    expect(await authenticator.passkeys(), "the sign-up stored one passkey").toHaveLength(1);
    await use(user);
  },

  openBrowser: async (
    { browser, browserName, consoleGuard, passkeyAutofill, baseURL },
    use,
    testInfo,
  ) => {
    const opened: BrowserContext[] = [];
    await use(async (options = {}) => {
      if (browserName !== "chromium") throw new Error("A second browser needs Chromium's passkeys");
      const context = await browser.newContext({
        ...projectContextOptions(testInfo),
        ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
      });
      opened.push(context);
      await prepare(context, {
        guard: consoleGuard,
        passkeyAutofill,
        appOrigin: appOriginOf(baseURL),
      });
      const page = await context.newPage();
      return { context, page, authenticator: await VirtualAuthenticator.attach(page) };
    });
    for (const context of opened) await context.close();
  },
});
