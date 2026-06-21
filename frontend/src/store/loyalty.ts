import { useCallback, useEffect, useState } from "react";

import { api, type Loyalty } from "@/src/api";

export function useLoyalty(guestId: string | undefined) {
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!guestId) return;
    try {
      setLoading(true);
      const data = await api.getLoyalty(guestId);
      setLoyalty(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [guestId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { loyalty, loading, refresh };
}
