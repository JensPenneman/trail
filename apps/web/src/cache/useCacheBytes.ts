import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { browserCacheOf } from "./attachBrowserCache";

/** The bytes the copy takes as the store counts them; null while they are read. */
export function useCacheBytes(): number | null {
  const client = useQueryClient();
  const cache = browserCacheOf(client);
  const [bytes, setBytes] = useState<number | null>(cache === null ? 0 : null);
  useEffect(() => {
    if (cache === null) return;
    let current = true;
    const read = () => {
      void cache.bytes().then((value) => {
        if (current) setBytes(value);
      });
    };
    read();
    const unsubscribe = cache.subscribe(read);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [cache]);
  return bytes;
}
