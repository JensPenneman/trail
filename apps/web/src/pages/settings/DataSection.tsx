import { useState } from "react";
import { Button } from "../../ui/Button";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { DeleteRangeForm } from "./DeleteRangeForm";
import { ExportForm } from "./ExportForm";

/** Take the data out, remove some of it, or remove all of it. */
export function DataSection({ headingId }: { headingId: string }) {
  const [deletingAccount, setDeletingAccount] = useState(false);
  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        Your data
      </h2>
      <div className="card">
        <h3 className="settings__subtitle">Export</h3>
        <ExportForm />
      </div>
      <div className="card">
        <h3 className="settings__subtitle">Delete a period</h3>
        <DeleteRangeForm />
      </div>
      <div className="card settings__danger">
        <div>
          <h3 className="settings__subtitle">Delete account</h3>
          <p className="muted">Removes you, your devices and all of their data from this server.</p>
        </div>
        <Button variant="danger-outline" icon="trash" onClick={() => setDeletingAccount(true)}>
          Delete account…
        </Button>
      </div>
      <DeleteAccountDialog open={deletingAccount} onClose={() => setDeletingAccount(false)} />
    </section>
  );
}
