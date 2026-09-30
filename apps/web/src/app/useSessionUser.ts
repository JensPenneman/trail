import type { SessionUser } from "@trail/contracts/user";
import { useContext } from "react";
import { SessionUserContext } from "./SessionUserContext";

/** Only valid below the route guard, where a session is guaranteed. */
export function useSessionUser(): SessionUser {
  const user = useContext(SessionUserContext);
  if (user === null) throw new Error("useSessionUser() used outside a signed-in route");
  return user;
}
