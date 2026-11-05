import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

/** A folded group of a person's page (a disclosure button), opened if it is closed. */
export async function openGroup(
  person: ReturnType<typeof userEvent.setup>,
  name: string | RegExp,
): Promise<HTMLElement> {
  const button = await screen.findByRole("button", { name });
  if (button.getAttribute("aria-expanded") === "false") await person.click(button);
  return button;
}
