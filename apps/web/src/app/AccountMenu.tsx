import { useSignOut } from "../queries/useSignOut";
import { Button } from "../ui/Button";
import { useSessionUser } from "./useSessionUser";
import "./AccountMenu.css";

/** Who is signed in, and the way out (on wide screens; phones find it under Settings). */
export function AccountMenu() {
  const user = useSessionUser();
  const signOut = useSignOut();
  return (
    <div className="account-menu">
      <span className="account-menu__name" title={user.email}>
        {user.displayName}
      </span>
      <Button
        variant="ghost"
        icon="signOut"
        busy={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        Sign out
      </Button>
    </div>
  );
}
