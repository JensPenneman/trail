import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Pages load lazily, as in the build (Settings has a chunk per page): the first
// one a test file opens is compiled then, which takes a while when the suite
// runs in parallel. `findBy…` and `waitFor` wait for it this long.
configure({ asyncUtilTimeout: 5000 });

/* jsdom has no modal dialogs, media queries or event streams; these stand-ins
 * give components the browser behaviour they rely on. */
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  if (!this.hasAttribute("open")) return;
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};

/** jsdom lays nothing out, so there is nothing to scroll into view ("Show on map" on phones). */
Element.prototype.scrollIntoView = function scrollIntoView() {};

/** Layout never changes in jsdom; tests that care call the callback themselves. */
class StillResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class SilentEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = 0;
  constructor(url: string) {
    super();
    this.url = url;
  }
  close(): void {
    this.readyState = 2;
  }
}

beforeEach(() => {
  // A Belgian browser: English interface, Belgian conventions (see resolveFormatLocale).
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["nl-BE", "en-GB"]);
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  vi.stubGlobal("EventSource", SilentEventSource);
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
});

afterEach(() => {
  cleanup();
});
