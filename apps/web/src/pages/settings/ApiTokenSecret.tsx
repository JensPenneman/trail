import { apiPaths } from "@trail/contracts/apiPaths";
import { Button } from "../../ui/Button";
import { CopyField } from "../../ui/CopyField";
import { Notice } from "../../ui/Notice";
import "./ApiTokens.css";

interface ApiTokenSecretProps {
  secret: string;
  onDone: () => void;
}

/**
 * The one moment a token's secret is on screen: Trail keeps only its hash, so
 * it cannot be shown again. The dialog around it cannot be dismissed by
 * accident; "I have saved it" is the way out.
 */
export function ApiTokenSecret({ secret, onDone }: ApiTokenSecretProps) {
  return (
    <div className="token-secret">
      <Notice tone="warning" title="Copy it now: it is shown only this once">
        <p>
          Put it into the app or script that uses it, or into your password manager. Trail keeps
          only a fingerprint of it; when it gets lost, roll the token for a new one.
        </p>
      </Notice>
      <CopyField label="API token" value={secret} />
      <div className="token-secret__try">
        <p className="field__label">Try it</p>
        <pre className="token-secret__command mono">
          <code>{`curl -H "Authorization: Bearer $TRAIL_TOKEN" \\\n  ${window.location.origin}${apiPaths.v1.tokens.verify}`}</code>
        </pre>
      </div>
      <div className="dialog__actions">
        <Button variant="primary" icon="check" onClick={onDone}>
          I have saved it
        </Button>
      </div>
    </div>
  );
}
