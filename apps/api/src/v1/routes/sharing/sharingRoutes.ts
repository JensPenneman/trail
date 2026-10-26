import type { V1Route } from "../../defineRoute";
import { confirmShare } from "./confirmShare";
import { createShare } from "./createShare";
import { createShareLink } from "./createShareLink";
import { deleteShare } from "./deleteShare";
import { deleteShareLink } from "./deleteShareLink";
import { getPerson } from "./getPerson";
import { getPersonTrack } from "./getPersonTrack";
import { hideIncomingShare } from "./hideIncomingShare";
import { listIncomingShares } from "./listIncomingShares";
import { listPeople } from "./listPeople";
import { listShareLinks } from "./listShareLinks";
import { listShares } from "./listShares";
import { unhideIncomingShare } from "./unhideIncomingShare";
import { updateShare } from "./updateShare";

/** The people, shares and public-link operations, in the order of the reference. */
export const sharingRoutes: readonly V1Route[] = [
  listPeople,
  getPerson,
  getPersonTrack,
  listShares,
  createShare,
  updateShare,
  confirmShare,
  deleteShare,
  listIncomingShares,
  hideIncomingShare,
  unhideIncomingShare,
  listShareLinks,
  createShareLink,
  deleteShareLink,
];
