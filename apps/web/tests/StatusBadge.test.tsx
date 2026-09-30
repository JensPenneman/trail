import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../src/ui/StatusBadge";

const thresholds = { liveMinutes: 15, staleHours: 12 };

describe("StatusBadge", () => {
  it.each([
    ["live", "Live", /last 15 minutes/],
    ["idle", "Idle", /last 12 hours/],
    ["stale", "Silent", /more than 12 hours/],
    ["never", "No data yet", /not uploaded anything/],
  ] as const)("names the %s status in words, with its meaning", (status, label, meaning) => {
    render(<StatusBadge status={status} thresholds={thresholds} />);
    const badge = screen.getByText(label).closest(".status-badge");
    expect(badge).toHaveClass(`status-badge--${status}`);
    expect(badge).toHaveAttribute("title", expect.stringMatching(meaning));
  });
});
