import { z } from "zod";

/*
 * Zod probes for `new Function` to compile faster object parsers, and it does
 * so while the contract schemas are constructed. The CSP forbids eval, and a
 * strict CSP reports even the failed probe as a violation, so the probe is
 * switched off before any schema exists: main.tsx imports this module first,
 * and the build puts it into the zod chunk, which every chunk holding
 * schemas imports and therefore evaluates after it. Interpreted parsing is
 * plenty fast for these payloads.
 */
z.config({ jitless: true });
