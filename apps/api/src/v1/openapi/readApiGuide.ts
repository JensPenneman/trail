import { readFileSync } from "node:fs";
import { apiGuidePath } from "../../packagedFiles";

/** docs/api.md without its title: the reference shows the document's own title above the guide. */
export function readApiGuide(): string {
  return readFileSync(apiGuidePath(), "utf8")
    .replace(/^# [^\n]*\n+/, "")
    .trimEnd();
}
