import { useMutation } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type CreatePasskeyLinkRequest,
  createPasskeyLinkResponseSchema,
} from "@trail/contracts/passkeyLink";
import { apiFetch } from "../api/apiFetch";

/** A one-time link (15 min) to add a passkey on another device or another allowed address. */
export function useCreatePasskeyLink() {
  return useMutation({
    mutationFn: (body: CreatePasskeyLinkRequest) =>
      apiFetch(apiPaths.me.passkeyLinks, createPasskeyLinkResponseSchema, { body }),
  });
}
