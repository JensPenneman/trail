import type { Request } from "express";
import { notFound } from "./httpError";

/** A path parameter as a string; a missing or repeated one cannot name a resource (404). */
export function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string") throw notFound();
  return value;
}
