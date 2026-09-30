/** A push notification about a device (ntfy). */
export interface Alert {
  title: string;
  message: string;
  tags: readonly string[];
  priority: "default" | "high";
}

/** Delivers an alert; rejects when delivery failed. */
export type AlertSender = (alert: Alert) => Promise<void>;
