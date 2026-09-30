import "./app/zodJitless";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { createAppRouter } from "./app/createAppRouter";
import { createQueryClient } from "./app/createQueryClient";
import { isSignedInPath } from "./app/isSignedInPath";
import { configQuery } from "./queries/configQuery";
import { sessionQuery } from "./queries/sessionQuery";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/lists.css";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element");

const queryClient = createQueryClient();
// Start these requests now instead of after the first page's code has loaded. Public pages
// (sign-in, invites, links) never ask for the session: signed out, that is a 401 by contract.
if (isSignedInPath(window.location.pathname)) void queryClient.prefetchQuery(sessionQuery);
void queryClient.prefetchQuery(configQuery);

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createAppRouter()} />
    </QueryClientProvider>
  </StrictMode>,
);
