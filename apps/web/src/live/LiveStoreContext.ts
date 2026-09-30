import { createContext } from "react";
import type { LiveStore } from "./createLiveStore";

export const LiveStoreContext = createContext<LiveStore | null>(null);
