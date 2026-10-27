import type { ReactNode } from "react";
import { Icon } from "../../ui/Icon";
import { QrCode } from "../../ui/QrCode";
import { useMediaQuery } from "../../ui/useMediaQuery";

interface SetupCodeProps {
  /** The app's setup link: opened on the phone, or scanned as a QR code. */
  url: string;
  appName: string;
  deviceName: string;
  /** "iPhone" for an app that only runs there, otherwise "phone". */
  phone: string;
  /** What the link fills in, e.g. "the endpoint, token and device ID". */
  fills: string;
  /** Said before everything else, e.g. a setting the link needs first. */
  first?: ReactNode;
}

/**
 * A setup link three ways: a QR code for the phone's camera, a button for
 * when this page is open on the phone itself, and (by the caller) the plain
 * values. On a phone-sized screen the button comes first — that screen
 * probably is the phone.
 */
export function SetupCode({ url, appName, deviceName, phone, fills, first }: SetupCodeProps) {
  const onPhone = useMediaQuery("(max-width: 34rem)");
  const openLink = (
    <a className="button button--primary" href={url}>
      <Icon name="external" />
      <span>Open in {appName}</span>
    </a>
  );
  const code = (
    <QrCode
      value={url}
      label={`Setup code for ${deviceName}: scanning it opens ${appName} with the connection filled in`}
    />
  );
  const cameraApp = phone === "iPhone" ? "the iPhone’s Camera app" : "the phone’s camera";
  return onPhone ? (
    <div className="credentials__setup">
      {first}
      <p className="credentials__step">
        <strong>On this {phone}?</strong> Open {appName} with {fills} filled in.
      </p>
      {openLink}
      <p className="credentials__hint">
        Setting up another {phone}? Scan this with {cameraApp}:
      </p>
      {code}
    </div>
  ) : (
    <div className="credentials__setup credentials__setup--wide">
      {code}
      <div className="credentials__setup-text">
        {first}
        <p className="credentials__step">
          <strong>Scan with {cameraApp}.</strong> {appName} opens with {fills} filled in.
        </p>
        {openLink}
        <p className="credentials__hint">Viewing this on the {phone} itself? Tap the button.</p>
      </div>
    </div>
  );
}
