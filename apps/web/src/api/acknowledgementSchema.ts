import { z } from "zod";

/**
 * For mutations whose answer carries nothing the contract defines (a 204, or a
 * small acknowledgement): the body is accepted without inspection and the
 * affected caches are refetched instead of trusting it.
 */
export const acknowledgementSchema = z.unknown();
