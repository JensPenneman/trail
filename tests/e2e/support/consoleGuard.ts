import type { BrowserContext, ConsoleMessage, Page } from "@playwright/test";

/** Chrome's wording when a request gets a non-2xx answer; the page itself logged nothing. */
const failedResource = /^Failed to load resource: the server responded with a status of (\d{3})/;

interface ExpectedFailure {
  status: number;
  url: RegExp;
}

/**
 * Collects everything a clean page never produces: console errors, uncaught
 * exceptions and Content Security Policy violations. A test that provokes an
 * error answer on purpose (a refused sign-up, a foreign device) declares that
 * one response with `expectFailedResponse`; anything else fails the test.
 */
export class ConsoleGuard {
  readonly #problems: string[] = [];
  readonly #expected: ExpectedFailure[] = [];

  /** Watches every page of the context, including the ones it opens later. */
  async watch(context: BrowserContext): Promise<void> {
    await context.exposeBinding("__trailCspViolation", ({ page }, detail: unknown) => {
      this.#problems.push(`CSP violation on ${page.url()}: ${JSON.stringify(detail)}`);
    });
    await context.addInitScript(() => {
      document.addEventListener(
        "securitypolicyviolation",
        (event) => {
          const report = Reflect.get(window, "__trailCspViolation");
          if (typeof report === "function") {
            report({
              directive: event.effectiveDirective,
              blocked: event.blockedURI,
              source: `${event.sourceFile}:${event.lineNumber}`,
            });
          }
        },
        { capture: true },
      );
    });
    for (const page of context.pages()) this.#attach(page);
    context.on("page", (page) => this.#attach(page));
  }

  /** The test causes this error response itself; Chrome's console line about it is fine. */
  expectFailedResponse(status: number, url: RegExp): void {
    this.#expected.push({ status, url });
  }

  problems(): readonly string[] {
    return this.#problems;
  }

  #attach(page: Page): void {
    page.on("console", (message) => {
      if (message.type() === "error" && !this.#isExpected(message)) {
        this.#problems.push(
          `console error on ${page.url()}: ${message.text()} (${where(message)})`,
        );
      }
    });
    page.on("pageerror", (error) => {
      this.#problems.push(`uncaught ${error.name} on ${page.url()}: ${error.message}`);
    });
  }

  #isExpected(message: ConsoleMessage): boolean {
    const status = failedResource.exec(message.text())?.[1];
    if (status === undefined) return false;
    const url = message.location().url;
    return this.#expected.some(
      (expected) => expected.status === Number(status) && expected.url.test(url),
    );
  }
}

function where(message: ConsoleMessage): string {
  const { url, lineNumber } = message.location();
  return url === "" ? "no location" : `${url}:${lineNumber}`;
}
