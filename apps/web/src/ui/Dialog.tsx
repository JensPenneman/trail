import { type ReactNode, useEffect, useId, useLayoutEffect, useRef } from "react";
import { Button } from "./Button";
import "./Dialog.css";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** `l` for content-heavy flows (device setup); full-screen on phones either way. */
  size?: "s" | "m" | "l";
  /** False while a request runs, so Escape or a backdrop click cannot abandon it halfway. */
  dismissible?: boolean;
  children: ReactNode;
}

/**
 * A modal on the native `<dialog>`: the browser makes the rest of the page
 * inert, traps focus and handles Escape. Content is only mounted while open,
 * so every opening starts from a clean state. Focus goes to the element marked
 * `data-autofocus` (else the title) and returns to the opener afterwards.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = "m",
  dismissible = true,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<Element | null>(null);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement;
      dialog.showModal();
      const target = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? titleRef.current;
      target?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // A multi-step dialog swaps its content (and title); focus follows to the new step's title.
  const shownTitle = useRef(title);
  useEffect(() => {
    if (!open) {
      shownTitle.current = title;
      return;
    }
    if (shownTitle.current !== title) {
      shownTitle.current = title;
      titleRef.current?.focus();
    }
  }, [open, title]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (dismissible) onClose();
    };
    const onNativeClose = () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      openerRef.current = null;
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onNativeClose);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onNativeClose);
    };
  }, [dismissible, onClose]);

  return (
    // The dialog element itself is the backdrop hit area; keyboard users close with Escape.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled natively through `cancel`
    <dialog
      ref={dialogRef}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const onBackdrop = event.target === event.currentTarget && pressStartedOnBackdrop.current;
        pressStartedOnBackdrop.current = false;
        if (onBackdrop && dismissible) onClose();
      }}
    >
      {open ? (
        <div className="dialog__panel">
          <header className="dialog__header">
            <div className="dialog__heading">
              <h2 className="dialog__title" id={titleId} ref={titleRef} tabIndex={-1}>
                {title}
              </h2>
              {description === undefined ? null : (
                <div className="dialog__description" id={descriptionId}>
                  {description}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              icon="close"
              iconOnly
              onClick={onClose}
              disabled={!dismissible}
              className="dialog__close"
            >
              Close
            </Button>
          </header>
          <div className="dialog__body">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
