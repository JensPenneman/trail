import "./app/zodJitless";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { createAppRouter } from "./app/createAppRouter";
import { createQueryClient } from "./app/createQueryClient";
import { isSignedInPath } from "./app/isSignedInPath";
import { registerServiceWorker } from "./app/registerServiceWorker";
import { createBrowserCache } from "./cache/browserCache";
import { configQuery } from "./queries/configQuery";
import { sessionQuery } from "./queries/sessionQuery";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/lists.css";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element");

// A page opened without a network knows it from the start: nothing is asked until it returns.
onlineManager.setOnline(navigator.onLine);
const browserCache = createBrowserCache();
const queryClient = createQueryClient(browserCache);
// Start these requests now instead of after the first page's code has loaded. Public pages
// (sign-in, invites, links) never ask for the session: signed out, that is a 401 by contract.
// On the others the store is read meanwhile — whose it is and the warm set — and only used
// once the session says it is that person's.
if (isSignedInPath(window.location.pathname)) {
  browserCache.prepare();
  void queryClient.prefetchQuery(sessionQuery);
}
void queryClient.prefetchQuery(configQuery);
registerServiceWorker();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createAppRouter()} />
    </QueryClientProvider>
  </StrictMode>,
);
