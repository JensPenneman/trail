import { useContext } from "react";
import { type Announce, AnnouncerContext } from "./AnnouncerContext";

export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}
