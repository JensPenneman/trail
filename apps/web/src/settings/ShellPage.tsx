import { type MouseEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { DocumentTitle } from "../app/DocumentTitle";
import "../ui/BackLink.css";
import { Icon } from "../ui/Icon";
import { openedFrom } from "./openedFrom";
import { addressOf } from "./useSettingsLink";
import "./ShellPage.css";

/** The way up from a screen: the screen it belongs to. */
export interface ShellUp {
  to: string;
  label: string;
  /** Shown on wide screens too, where the list is not enough (a single item's pages). */
  always: boolean;
}

interface ShellPageProps {
  title: string;
  /** The tab's title, before "· Trail". */
  documentTitle: string;
  /** Null at the root of a shell: nothing above it. */
  up: ShellUp | null;
  description?: ReactNode;
  /** Between the title and the content: controls that belong to the screen as a whole. */
  controls?: ReactNode;
  children: ReactNode;
}

/**
 * The way up: the screen this one belongs to. Opened from there, it goes back
 * in the browser's history (as the iPhone pops a page), so Back and Forward
 * keep making sense; opened from anywhere else (a bookmark), it goes there.
 */
function BackLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  const { state } = useLocation();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const plain =
      event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
    if (!plain || !openedFrom(state, addressOf(to).pathname)) return;
    event.preventDefault();
    void navigate(-1);
  };
  return (
    <Link to={to} className="shell-page__back back-link" onClick={onClick}>
      <Icon name="chevronLeft" className="back-link__icon" />
      <span className="back-link__label">
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
 * A screen of a shell (Settings, Insights): a landmark named by its title,
 * which is the screen's h1 and where focus goes when it opens (useRouteFocus).
 * Above it a bar with the way back: on phones always (the list is a screen of
 * its own there), beside the list on wide screens only where `up.always`.
 */
export function ShellPage({
  title,
  documentTitle,
  up,
  description,
  controls,
  children,
}: ShellPageProps) {
  const titleId = useId();
  const { barRef, titleRef, compact } = useCompactTitle();
  return (
    <section className="shell-page" aria-labelledby={titleId}>
      <DocumentTitle title={documentTitle} />
      <div
        ref={barRef}
        className={`shell-page__bar${up?.always === true ? " shell-page__bar--always" : ""}`}
        data-compact={compact ? "" : undefined}
      >
        {up === null ? null : <BackLink to={up.to} label={up.label} />}
        <p className="shell-page__compact-title" aria-hidden="true">
          {title}
        </p>
      </div>
      <header className="shell-page__header">
        <h1 ref={titleRef} className="shell-page__title" id={titleId} tabIndex={-1} data-page-title>
          {title}
        </h1>
        {description === undefined ? null : (
          <div className="shell-page__description">{description}</div>
        )}
      </header>
      {controls}
      {children}
    </section>
  );
}
