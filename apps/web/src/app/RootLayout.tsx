import { Outlet } from "react-router";
import { AnnouncerProvider } from "../ui/AnnouncerProvider";

/** Wraps every route with the app-wide live region. */
export function RootLayout() {
  return (
    <AnnouncerProvider>
      <Outlet />
    </AnnouncerProvider>
  );
}
