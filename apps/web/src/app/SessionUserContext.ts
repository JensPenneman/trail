import type { SessionUser } from "@trail/contracts/user";
import { createContext } from "react";

/** The signed-in person, provided by the route guard to every signed-in screen. */
export const SessionUserContext = createContext<SessionUser | null>(null);
