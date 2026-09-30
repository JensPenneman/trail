import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

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
});

afterEach(() => {
  cleanup();
});
