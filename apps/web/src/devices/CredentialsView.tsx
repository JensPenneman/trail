import type { DeviceCredentials } from "@trail/contracts/device";
import type { ReactNode } from "react";
import { CopyField } from "../ui/CopyField";
import { Icon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { QrCode } from "../ui/QrCode";
import { useMediaQuery } from "../ui/useMediaQuery";
import { RecommendedSettings } from "./RecommendedSettings";
import "./CredentialsView.css";

interface CredentialsViewProps {
  deviceName: string;
  credentials: DeviceCredentials;
  /** Shown right below the setup code: whether the phone has checked in yet. */
  status: ReactNode;
}

/**
 * What the phone needs, three ways: a QR code for the iPhone camera, a link
 * for when this page is open on the phone itself, and the plain values. On a
 * phone-sized screen the link comes first — that screen probably is the phone.
 */
export function CredentialsView({ deviceName, credentials, status }: CredentialsViewProps) {
  const onPhone = useMediaQuery("(max-width: 34rem)");
  const openLink = (
    <a className="button button--primary" href={credentials.setupUrl}>
      <Icon name="external" />
      <span>Open in Overland</span>
    </a>
  );
  const code = (
    <QrCode
      value={credentials.setupUrl}
      label={`Setup code for ${deviceName}: scanning it opens Overland with the connection filled in`}
    />
  );

  return (
    <div className="credentials">
      {onPhone ? (
        <div className="credentials__setup">
          <p className="credentials__step">
            <strong>On this iPhone?</strong> Open Overland with the endpoint, token and device ID
            filled in.
          </p>
          {openLink}
          <p className="credentials__hint">Setting up another iPhone? Scan this with its camera:</p>
          {code}
        </div>
      ) : (
        <div className="credentials__setup credentials__setup--wide">
          {code}
          <div className="credentials__setup-text">
            <p className="credentials__step">
              <strong>Scan with the iPhone’s Camera app.</strong> Overland opens with the endpoint,
              token and device ID filled in.
            </p>
            {openLink}
            <p className="credentials__hint">Viewing this on the iPhone itself? Tap the button.</p>
          </div>
        </div>
      )}

      {status}

      <Notice tone="warning" title="The access token is shown only this once">
        <p>
          Copy it now or scan the code. Lost it? Issue a new token from the device’s page — that
          stops the old one.
        </p>
      </Notice>

      <div className="credentials__values">
        <CopyField label="Receiver endpoint" value={credentials.endpoint} />
        <CopyField label="Access token" value={credentials.accessToken} />
        <CopyField label="Device ID" value={credentials.deviceKey} />
      </div>

      <RecommendedSettings />
    </div>
  );
}
