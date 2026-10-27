import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DeviceCredentials } from "@trail/contracts/device";
import { describe, expect, it } from "vitest";
import { CredentialsView } from "../src/devices/CredentialsView";
import { AnnouncerProvider } from "../src/ui/AnnouncerProvider";

const token = "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS";

const show = (credentials: DeviceCredentials) =>
  render(
    <AnnouncerProvider>
      <CredentialsView
        deviceName="Lotte’s phone"
        credentials={credentials}
        status={<p>Waiting</p>}
      />
    </AnnouncerProvider>,
  );

describe("CredentialsView", () => {
  it("offers Overland's setup code, its link and every value to copy", () => {
    const credentials: DeviceCredentials = {
      app: "overland",
      endpoint: "https://trail.example.com/api/overland",
      accessToken: token,
      deviceKey: "lottes-iphone-x2k8",
      setupUrl: `overland://setup?url=https%3A%2F%2Ftrail.example.com%2Fapi%2Foverland&token=${token}&device_id=lottes-iphone-x2k8`,
    };
    show(credentials);
    const code = screen.getByRole("img", { name: /Setup code for Lotte’s phone/ });
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

  it("links OwnTracks per platform and gives every value for setting it up by hand", async () => {
    const person = userEvent.setup();
    show({
      app: "owntracks",
      endpoint: "https://trail.example.com/api/owntracks",
      username: "lottes-phone-x2k8",
      accessToken: token,
      deviceId: "lottes-phone-x2k8",
      trackerId: "LP",
      setupUrls: {
        ios: "owntracks:///config?inline=aW9z",
        android: "owntracks:///config?inline=YW5kcm9pZA%3D%3D",
      },
    });
    const link = () => screen.getByRole("link", { name: "Open in OwnTracks" });
    expect(link()).toHaveAttribute("href", "owntracks:///config?inline=aW9z");
    expect(screen.getByText(/Allow external configuration/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /on an iPhone/ })).toBeInTheDocument();
    await person.click(screen.getByRole("radio", { name: "Android" }));
    expect(link()).toHaveAttribute("href", "owntracks:///config?inline=YW5kcm9pZA%3D%3D");
    expect(screen.getByRole("heading", { name: /on Android/ })).toBeInTheDocument();
    expect(screen.getByText("Location interval (Move mode)")).toBeInTheDocument();
    expect(screen.getByLabelText("URL")).toHaveValue("https://trail.example.com/api/owntracks");
    expect(screen.getByLabelText("Username")).toHaveValue("lottes-phone-x2k8");
    expect(screen.getByLabelText("Password (access token)")).toHaveValue(token);
    expect(screen.getByLabelText("Device ID")).toHaveValue("lottes-phone-x2k8");
    expect(screen.getByLabelText("Tracker ID")).toHaveValue("LP");
  });

  it("links Traccar Client and says that its identifier is the token", () => {
    show({
      app: "traccar",
      endpoint: "https://trail.example.com/api/osmand",
      accessToken: token,
      setupUrl: `org.traccar.client://setup?url=https%3A%2F%2Ftrail.example.com%2Fapi%2Fosmand&id=${token}`,
    });
    expect(screen.getByRole("link", { name: "Open in Traccar Client" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^org\.traccar\.client:\/\/setup\?/),
    );
    expect(screen.getByLabelText("Server URL")).toHaveValue("https://trail.example.com/api/osmand");
    expect(screen.getByLabelText("Device identifier (access token)")).toHaveValue(token);
    expect(
      screen.getByText("Traccar Client shows the identifier on its main screen"),
    ).toBeInTheDocument();
    expect(screen.getByText("Stop detection")).toBeInTheDocument();
  });

  it("gives OsmAnd its web address and GPSLogger its URL, header and method", () => {
    const osmand = `https://trail.example.com/api/osmand?token=${token}&lat={0}&lon={1}`;
    const { unmount } = show({
      app: "osmand",
      endpoint: "https://trail.example.com/api/osmand",
      accessToken: token,
      urlTemplate: osmand,
    });
    expect(screen.queryByRole("img", { name: /Setup code/ })).toBeNull();
    expect(screen.getByLabelText("Web address")).toHaveValue(osmand);
    expect(screen.getByText(/Start recording a trip/)).toBeInTheDocument();
    unmount();

    show({
      app: "gpslogger",
      endpoint: "https://trail.example.com/api/osmand",
      accessToken: token,
      url: "https://trail.example.com/api/osmand?lat=%LAT&lon=%LON",
      headers: `Authorization: Bearer ${token}`,
    });
    const values = screen.getByLabelText("URL").closest(".credentials__values");
    if (!(values instanceof HTMLElement)) throw new Error("no values");
    expect(within(values).getByLabelText("URL")).toHaveValue(
      "https://trail.example.com/api/osmand?lat=%LAT&lon=%LON",
    );
    expect(within(values).getByLabelText("HTTP Headers")).toHaveValue(
      `Authorization: Bearer ${token}`,
    );
    expect(within(values).getByLabelText("HTTP Method")).toHaveValue("GET");
    expect(screen.getByText("Keep GPS on between fixes")).toBeInTheDocument();
  });
});
