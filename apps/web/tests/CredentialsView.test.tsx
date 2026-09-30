import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CredentialsView } from "../src/devices/CredentialsView";
import { AnnouncerProvider } from "../src/ui/AnnouncerProvider";

const credentials = {
  endpoint: "https://trail.example.com/api/overland",
  accessToken: "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS",
  deviceKey: "lottes-iphone-x2k8",
  setupUrl:
    "overland://setup?url=https%3A%2F%2Ftrail.example.com%2Fapi%2Foverland&token=trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS&device_id=lottes-iphone-x2k8",
};

describe("CredentialsView", () => {
  it("offers the setup code, the Overland link and every value to copy", () => {
    render(
      <AnnouncerProvider>
        <CredentialsView
          deviceName="Lotte’s iPhone"
          credentials={credentials}
          status={<p>Waiting</p>}
        />
      </AnnouncerProvider>,
    );
    const code = screen.getByRole("img", { name: /Setup code for Lotte’s iPhone/ });
    expect(code.querySelector("path")?.getAttribute("d")).toMatch(/^M\d+ \d+h\d+/);
    expect(screen.getByRole("link", { name: "Open in Overland" })).toHaveAttribute(
      "href",
      credentials.setupUrl,
    );
    expect(screen.getByLabelText("Receiver endpoint")).toHaveValue(credentials.endpoint);
    expect(screen.getByLabelText("Access token")).toHaveValue(credentials.accessToken);
    expect(screen.getByLabelText("Device ID")).toHaveValue(credentials.deviceKey);
    expect(screen.getByText("The access token is shown only this once")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy access token" })).toBeInTheDocument();
    expect(screen.getByText("Logging mode")).toBeInTheDocument();
  });
});
