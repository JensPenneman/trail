import { Notice } from "../../ui/Notice";

/** Trail keeps only the token's hash: this is the one time anybody sees it. */
export function TokenOnceNotice({ where }: { where: string }) {
  return (
    <Notice tone="warning" title="The access token is shown only this once">
      <p>
        Copy it now or {where}. Lost it? Issue a new token from the device’s page — that stops the
        old one.
      </p>
    </Notice>
  );
}
