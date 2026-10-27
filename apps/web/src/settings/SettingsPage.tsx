import { type MouseEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { DocumentTitle } from "../app/DocumentTitle";
import { Icon } from "../ui/Icon";
import { openedFrom } from "./openedFrom";
import { type SettingsPageId, settingsPage, settingsRootPath } from "./settingsTree";
import "./SettingsPage.css";

interface SettingsPageProps {
  /** A page of the root list: title and description come from the tree. */
  page?: SettingsPageId;
  /** A page one level deeper: the page it belongs to, where its back control leads. */
  parent?: SettingsPageId;
  /** The title, when it is not the tree page's own (an item's name). */
  title?: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * The way up: the page this one belongs to. Opened from there, it goes back
 * in the browser's history (as the iPhone pops a page), so Back and Forward
 * keep making sense; opened from anywhere else (a bookmark), it goes there.
 */
function BackLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  const { state } = useLocation();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const plain =
      event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
    if (!plain || !openedFrom(state, to)) return;
    event.preventDefault();
    void navigate(-1);
  };
  return (
    <Link to={to} className="settings-back" onClick={onClick}>
      <Icon name="chevronLeft" className="settings-back__icon" />
      <span className="settings-back__label">
        <span className="visually-hidden">Back to</span> {label}
      </span>
    </Link>
  );
}

/**
 * On phones the title starts large and moves into the bar once it scrolls
 * under it, as on the iPhone; wide screens keep it where it is.
 */
function useCompactTitle() {
  const barRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const bar = barRef.current;
      const title = titleRef.current;
      if (bar === null || title === null) return;
      setCompact(title.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);
  return { barRef, titleRef, compact };
}

/**
 * A page of Settings: a landmark named by its title, which is the page's h1
 * and where focus goes when the page opens (useRouteFocus). Above it a bar
 * with the way back: on phones always (the list is a page of its own there),
 * beside the list on wide screens only for the pages of single items.
 */
export function SettingsPage({ page, parent, title, description, children }: SettingsPageProps) {
  const titleId = useId();
  const { barRef, titleRef, compact } = useCompactTitle();
  const node = page === undefined ? undefined : settingsPage(page);
  const above = parent === undefined ? undefined : settingsPage(parent);
  const shownTitle = title ?? node?.label ?? "Settings";
  const shownDescription = description ?? node?.description;
  const up =
    above !== undefined
      ? { to: above.path, label: above.label, always: true }
      : node !== undefined
        ? { to: settingsRootPath, label: "Settings", always: false }
        : null;
  const documentTitle =
    above !== undefined
      ? `${shownTitle} · ${above.label} · Settings`
      : node !== undefined
        ? `${shownTitle} · Settings`
        : "Settings";
  return (
    <section className="settings-page" aria-labelledby={titleId}>
      <DocumentTitle title={documentTitle} />
      <div
        ref={barRef}
        className={`settings-page__bar${up?.always === true ? " settings-page__bar--always" : ""}`}
        data-compact={compact ? "" : undefined}
      >
        {up === null ? null : <BackLink to={up.to} label={up.label} />}
        <p className="settings-page__compact-title" aria-hidden="true">
          {shownTitle}
        </p>
      </div>
      <header className="settings-page__header">
        <h1
          ref={titleRef}
          className="settings-page__title"
          id={titleId}
          tabIndex={-1}
          data-page-title
        >
          {shownTitle}
        </h1>
        {shownDescription === undefined ? null : (
          <div className="settings-page__description">{shownDescription}</div>
        )}
      </header>
      {children}
    </section>
  );
}
