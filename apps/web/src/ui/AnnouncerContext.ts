import { createContext } from "react";

/** Speaks a short status message through the app's single polite live region. */
export type Announce = (message: string) => void;

export const AnnouncerContext = createContext<Announce>(() => undefined);
