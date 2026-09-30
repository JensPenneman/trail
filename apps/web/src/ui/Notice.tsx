import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import "./Notice.css";

type NoticeTone = "info" | "success" | "warning" | "danger";

const icons: Record<NoticeTone, IconName> = {
  info: "info",
  success: "check",
  warning: "warning",
  danger: "warning",
};

interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  /** `alert` for errors that appear in response to an action; static notices need no role. */
  role?: "alert" | "status";
  children?: ReactNode;
  action?: ReactNode;
}

export function Notice({ tone = "info", title, role, children, action }: NoticeProps) {
  return (
    <div className={`notice notice--${tone}`} role={role}>
      <Icon name={icons[tone]} className="notice__icon" />
      <div className="notice__content">
        {title === undefined ? null : <p className="notice__title">{title}</p>}
        {children === undefined ? null : <div className="notice__body">{children}</div>}
        {action === undefined ? null : <div className="notice__action">{action}</div>}
      </div>
    </div>
  );
}
