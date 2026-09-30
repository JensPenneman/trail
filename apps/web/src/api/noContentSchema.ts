import { z } from "zod";

/** Schema for 204 answers: `apiFetch` hands an empty body to the schema as `undefined`. */
export const noContentSchema = z.undefined();
