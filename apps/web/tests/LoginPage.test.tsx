import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  sendSignal,
  startAuthentication,
  WebAuthnError,
} from "@simplewebauthn/browser";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "../src/pages/login/LoginPage";
import { ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";

vi.mock("@simplewebauthn/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@simplewebauthn/browser")>();
  return {
    ...actual,
    browserSupportsWebAuthn: vi.fn(),
    browserSupportsWebAuthnAutofill: vi.fn(),
    startAuthentication: vi.fn(),
    startRegistration: vi.fn(),
    sendSignal: vi.fn(),
  };
});

const assertion = {
  id: "cred-1",
  rawId: "cred-1",
  type: "public-key" as const,
  clientExtensionResults: {},
  response: { authenticatorData: "a", clientDataJSON: "b", signature: "c" },
};

const authenticateStart = {
  status: 200,
  body: {
    flow: "authenticate",
    ceremonyId: ids.ceremony,
    options: { challenge: "Y2hhbGxlbmdl", allowCredentials: [], userVerification: "required" },
  },
};

async function continueWith(email: string) {
  const person = userEvent.setup();
  await person.type(screen.getByLabelText("Email address"), email);
  await person.click(screen.getByRole("button", { name: "Continue" }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
    vi.mocked(browserSupportsWebAuthnAutofill).mockResolvedValue(false);
    vi.mocked(sendSignal).mockResolvedValue(undefined);
  });

  it("offers autofill-ready email sign-in and a passkey button", () => {
    mockApi({});
    renderPage(<LoginPage />, { path: "/login" });
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "autocomplete",
      "username webauthn",
    );
    expect(screen.getByRole("button", { name: "Use a passkey" })).toBeEnabled();
  });

  it("checks the address before asking the server", async () => {
    const { calls } = mockApi({});
    renderPage(<LoginPage />, { path: "/login" });
    await continueWith("not an address");
    expect(screen.getByText(/Enter your email address/)).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "/api/auth/start")).toHaveLength(0);
  });

  it("explains that new accounts need an invitation", async () => {
    mockApi({
      "POST /api/auth/start": {
        status: 403,
        body: { error: { code: "signup_not_allowed", message: "Not invited" } },
      },
    });
    renderPage(<LoginPage />, { path: "/login" });
    await continueWith("new@example.com");
    expect(await screen.findByText("New accounts need an invitation")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("new@example.com has no account");
  });

  it("explains that this address has no passkey yet and how to get one", async () => {
    mockApi({
      "POST /api/auth/start": {
        status: 409,
        body: { error: { code: "no_passkey_for_origin", message: "Use a sign-in link" } },
      },
    });
    renderPage(<LoginPage />, { path: "/login" });
    await continueWith("jens@example.com");
    expect(await screen.findByText(/No passkey for .* yet/)).toBeInTheDocument();
    expect(screen.getByText(/Ask for a sign-in link/)).toBeInTheDocument();
  });

  it("treats a dismissed passkey sheet as cancelled, not as an error", async () => {
    mockApi({ "POST /api/auth/start": authenticateStart });
    vi.mocked(startAuthentication).mockRejectedValue(
      new WebAuthnError({
        message: "The operation either timed out or was not allowed.",
        code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
        cause: new DOMException("denied", "NotAllowedError"),
      }),
    );
    renderPage(<LoginPage />, { path: "/login" });
    await continueWith("jens@example.com");
    expect(await screen.findByText("No passkey was used")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("asks the browser to forget a passkey the server no longer knows", async () => {
    mockApi({
      "POST /api/auth/start": authenticateStart,
      "POST /api/auth/finish": {
        status: 401,
        body: { error: { code: "unknown_credential", message: "Unknown passkey" } },
      },
    });
    vi.mocked(startAuthentication).mockResolvedValue(assertion);
    renderPage(<LoginPage />, { path: "/login" });
    await continueWith("jens@example.com");
    expect(await screen.findByText("That passkey no longer works here")).toBeInTheDocument();
    expect(sendSignal).toHaveBeenCalledWith({
      signalName: "unknownCredential",
      rpID: "localhost",
      credentialID: "cred-1",
    });
  });

  it("says so when the browser cannot use passkeys at all", () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    mockApi({});
    renderPage(<LoginPage />, { path: "/login" });
    expect(screen.getByText("This browser can’t use passkeys")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("signs in and continues to the page that asked for it", async () => {
    const { calls } = mockApi({
      "POST /api/auth/start": authenticateStart,
      "POST /api/auth/finish": { status: 200, body: { user, created: false } },
    });
    vi.mocked(startAuthentication).mockResolvedValue(assertion);
    const { router } = renderPage(<LoginPage />, { path: "/login", url: "/login?next=%2Fhistory" });
    await continueWith("Jens@Example.com ");
    await waitFor(() => expect(router.state.location.pathname).toBe("/history"));
    expect(calls.find((call) => call.path === "/api/auth/start")?.body).toEqual({
      email: "jens@example.com",
    });
    expect(calls.find((call) => call.path === "/api/auth/finish")?.body).toEqual({
      ceremonyId: ids.ceremony,
      response: assertion,
    });
  });
});
