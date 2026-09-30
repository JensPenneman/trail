import type { Request } from "express";

/** The device an ingest request authenticated as, with what the ingest needs about its owner. */
export interface IngestDevice {
  id: string;
  name: string;
  userId: string;
  ownerName: string;
  timezone: string;
}

const deviceByRequest = new WeakMap<Request, IngestDevice>();

export function setIngestDevice(req: Request, device: IngestDevice): void {
  deviceByRequest.set(req, device);
}

/** The authenticated device; routes behind `authenticateDevice` always have one. */
export function ingestDeviceOf(req: Request): IngestDevice {
  const device = deviceByRequest.get(req);
  if (device === undefined) throw new Error("Ingest route reached without an authenticated device");
  return device;
}
