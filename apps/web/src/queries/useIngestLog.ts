import { useQuery, useQueryClient } from "@tanstack/react-query";
import { goneDevices } from "../devices/goneDevices";
import { ingestLogQuery } from "./ingestLogQuery";

export function useIngestLog(deviceId: string, limit: number) {
  const queryClient = useQueryClient();
  return useQuery({
    ...ingestLogQuery(deviceId, limit),
    enabled: () => !goneDevices.has(queryClient, deviceId),
    select: (response) => response.entries,
  });
}
