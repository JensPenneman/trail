import { z } from "zod";

const uuidSchema = z.uuid();

/** Path ids that are not UUIDs can never match a row; callers answer 404 without a query. */
export const isUuid = (value: string): boolean => uuidSchema.safeParse(value).success;
