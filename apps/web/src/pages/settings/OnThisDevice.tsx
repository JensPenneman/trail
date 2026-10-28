import { useEffect, useState } from "react";
import { useCacheBytes } from "../../cache/useCacheBytes";
import { useCacheCounters, useCacheEnabled } from "../../cache/useCacheEnabled";
import { useFormatter } from "../../format/useFormatter";
import { useLiveState } from "../../live/useLiveState";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsFact } from "../../settings/SettingsRow";

interface StorageFacts {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

/** What the browser says of Trail's storage: all of it (the copy and the app's shell), and its quota. */
function useStorageFacts(): StorageFacts | null {
  const [facts, setFacts] = useState<StorageFacts | null>(null);
  useEffect(() => {
    let current = true;
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    void Promise.all([
      storage?.estimate?.().catch(() => null) ?? Promise.resolve(null),
      storage?.persisted?.().catch(() => null) ?? Promise.resolve(null),
    ]).then(([estimate, persisted]) => {
      if (!current) return;
      setFacts({
        usage: estimate?.usage ?? null,
        quota: estimate?.quota ?? null,
        persisted: persisted ?? null,
      });
    });
    return () => {
      current = false;
    };
  }, []);
  return facts;
}

/**
 * Settings › About › On this device: what this browser keeps and what the
 * copy did during this visit. Counted here and shown here only; nothing of
 * it is sent anywhere.
 */
export function OnThisDevice() {
  const format = useFormatter();
  const copy = useCacheEnabled();
  const counters = useCacheCounters();
  const bytes = useCacheBytes();
  const storage = useStorageFacts();
  const { versions } = useLiveState();
  const state = !copy.on
    ? "Off: nothing is kept on this device"
    : !copy.available
      ? "Memory only: this browser keeps no copy now (no storage, or no room left)"
      : "On";
  return (
    <SettingsGroup
      title="On this device"
      id="device"
      variant="facts"
      footer="Safari deletes what a website keeps after seven days of use without a visit, unless Trail is on the Home Screen. It is only a copy: losing it costs the head start, never data."
    >
      <SettingsFact label="Copy of your data">{state}</SettingsFact>
      <SettingsFact label="Size of the copy">
        {bytes === null ? "…" : format.bytes(bytes)}
      </SettingsFact>
      {storage?.usage === null || storage === null ? null : (
        <SettingsFact label="Trail uses, by the browser’s count">
          {storage.quota === null
            ? format.bytes(storage.usage)
            : `${format.bytes(storage.usage)} of ${format.bytes(storage.quota)}`}
        </SettingsFact>
      )}
      {storage?.persisted === null || storage === null ? null : (
        <SettingsFact label="Kept when space runs low">
          {storage.persisted ? "Yes" : "No, the browser may delete it then"}
        </SettingsFact>
      )}
      {counters === null ? null : (
        <>
          <SettingsFact label="Restored this visit">
            {`${format.count(counters.restored)} answers, ${format.bytes(counters.restoredBytes)}`}
            {counters.warmMs === null
              ? null
              : `; the first screen’s in ${format.count(counters.warmMs)} ms`}
          </SettingsFact>
          <SettingsFact label="Shown from the copy">{format.count(counters.hits)}</SettingsFact>
          <SettingsFact label="Not in the copy">{format.count(counters.misses)}</SettingsFact>
          <SettingsFact label="Checked with the server">
            {`${format.count(counters.revalidations)}, unchanged ${format.count(counters.notModified)}`}
          </SettingsFact>
          <SettingsFact label="Dropped as out of date or damaged">
            {format.count(counters.invalid)}
          </SettingsFact>
          <SettingsFact label="Clean-ups">
            {`${format.count(counters.sweeps)}, removing ${format.count(counters.swept)}`}
          </SettingsFact>
          <SettingsFact label="Not written">{format.count(counters.refused)}</SettingsFact>
        </>
      )}
      {versions === null ? null : (
        <SettingsFact label="Processing on the server">
          {`Averaged ${versions.averaged} · mapped ${versions.mapped} · inferred ${versions.inferred}`}
        </SettingsFact>
      )}
    </SettingsGroup>
  );
}
