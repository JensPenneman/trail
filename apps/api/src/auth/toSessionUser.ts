import type { SessionUser } from "@trail/contracts/user";
import type { UserRow } from "./requestAuth";

export function toSessionUser(user: UserRow): SessionUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  };
}
