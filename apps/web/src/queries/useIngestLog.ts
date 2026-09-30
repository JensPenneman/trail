import { useQuery } from "@tanstack/react-query";
import { ingestLogQuery } from "./ingestLogQuery";

export function useIngestLog(deviceId: string, limit: number) {
  return useQuery({ ...ingestLogQuery(deviceId, limit), select: (response) => response.entries });
}
