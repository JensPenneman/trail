import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button";
import { copyText } from "./copyText";
import { useAnnounce } from "./useAnnounce";
import "./CopyField.css";

interface CopyFieldProps {
  label: string;
  value: string;
  /** Monospace for tokens and identifiers. */
  mono?: boolean;
  hint?: string;
}

/** A read-only value with a copy button; falls back to selecting the text for manual copying. */
export function CopyField({ label, value, mono = true, hint }: CopyFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const announce = useAnnounce();

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const onCopy = async () => {
    if (await copyText(value)) {
      setState("copied");
      announce(`${label} copied`);
      return;
    }
    setState("manual");
    inputRef.current?.select();
    announce(`Copying is blocked here. ${label} is selected; copy it with your keyboard or menu.`);
  };

  return (
    <div className="copy-field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint === undefined ? null : <p className="field__hint">{hint}</p>}
      <div className="copy-field__row">
        <input
          ref={inputRef}
          id={id}
          className={mono ? "input copy-field__value mono" : "input copy-field__value"}
          value={value}
          readOnly
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          icon={state === "copied" ? "check" : "copy"}
          aria-label={`${state === "copied" ? "Copied" : "Copy"} ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
          onClick={() => void onCopy()}
        >
          {state === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      {state === "manual" ? (
        <p className="field__hint">Selected — copy it with ⌘C / Ctrl+C or the context menu.</p>
      ) : null}
    </div>
  );
}
