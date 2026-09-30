import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InvitePage } from "../src/pages/invite/InvitePage";
import { LinkPage } from "../src/pages/link/LinkPage";
import { NotFoundPage } from "../src/pages/notFound/NotFoundPage";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";

vi.mock("@simplewebauthn/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@simplewebauthn/browser")>()),
  // jsdom has no WebAuthn; these screens only need to know that it would work.
  browserSupportsWebAuthn: () => true,
}));

const token = "inv_4b8c1d2e3f405162738495a6b7c8d9e0";
const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString();

describe("public pages", () => {
  it("pre-fills the address an invitation is bound to", async () => {
    mockApi({
      [`GET /api/auth/link/${token}`]: {
        status: 200,
        body: { kind: "invite", email: "lotte@example.com", expiresAt: inFiveDays },
      },
    });
    renderPage(<InvitePage />, { path: "/invite/:token", url: `/invite/${token}` });
    expect(await screen.findByDisplayValue("lotte@example.com")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Create account with a passkey" })).toBeEnabled();
  });

  it("explains a used or expired link", async () => {
    mockApi({
      [`GET /api/auth/link/${token}`]: {
        status: 404,
        body: { error: { code: "link_invalid", message: "Link expired" } },
      },
    });
    renderPage(<InvitePage />, { path: "/invite/:token", url: `/invite/${token}` });
    expect(await screen.findByText("This link can’t be used")).toBeInTheDocument();
  });

  it("offers a new passkey for the account of a passkey link", async () => {
    mockApi({
      [`GET /api/auth/link/${token}`]: {
        status: 200,
        body: { kind: "passkey", email: "jens@example.com", expiresAt: inFiveDays },
      },
    });
    renderPage(<LinkPage />, { path: "/link/:token", url: `/link/${token}` });
    expect(await screen.findByText("jens@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create passkey and sign in" })).toBeInTheDocument();
  });

  it("has a way back from an unknown address", () => {
    renderPage(<NotFoundPage />, { path: "/nope" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This trail goes nowhere");
    expect(screen.getByRole("link", { name: "Go to Live" })).toHaveAttribute("href", "/");
  });
});
