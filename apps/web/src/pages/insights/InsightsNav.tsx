import { Link, useLocation } from "react-router";
import { PlainList } from "../../ui/PlainList";
import { insightsLink } from "./insightsSearch";
import "./InsightsNav.css";

const pages = [
  { path: "/insights", label: "Overview" },
  { path: "/insights/time", label: "When you travel" },
  { path: "/insights/roads", label: "Roads" },
] as const;

/** The pages of Insights; the period and the devices go along, the current page says so. */
export function InsightsNav({ params }: { params: URLSearchParams }) {
  const { pathname } = useLocation();
  return (
    <nav className="insights-nav" aria-label="Insights">
      <PlainList className="insights-nav__list">
        {pages.map((page) => (
          <li key={page.path}>
            <Link
              to={insightsLink(page.path, params, { keepMode: page.path !== "/insights" })}
              className="insights-nav__link"
              aria-current={pathname === page.path ? "page" : undefined}
            >
              {page.label}
            </Link>
          </li>
        ))}
      </PlainList>
    </nav>
  );
}
