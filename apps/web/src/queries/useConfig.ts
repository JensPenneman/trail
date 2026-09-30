import { useQuery } from "@tanstack/react-query";
import { configQuery } from "./configQuery";

export function useConfig() {
  return useQuery(configQuery);
}
