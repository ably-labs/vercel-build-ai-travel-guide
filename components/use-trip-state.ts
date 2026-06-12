"use client";

import { useAbly } from "ably/react";
import { useEffect, useState } from "react";

import { stateChannelName } from "@/lib/channels";
import type { TripStateJson } from "@/lib/trip-state";

// Subscribe to a trip's LiveObjects state and re-render on every change.
// Must be used under a mounted AblyProvider (check RealtimeReadyContext
// before rendering a component that calls this).
export function useTripState(tripId: string): TripStateJson | null {
  const ably = useAbly();
  const [state, setState] = useState<TripStateJson | null>(null);

  useEffect(() => {
    const channel = ably.channels.get(stateChannelName(tripId), {
      modes: ["OBJECT_SUBSCRIBE", "OBJECT_PUBLISH"],
    });
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | undefined;

    (async () => {
      try {
        const root = await channel.object.get();
        if (cancelled) return;
        setState((root.compactJson() ?? {}) as TripStateJson);
        subscription = root.subscribe(() => {
          setState((root.compactJson() ?? {}) as TripStateJson);
        });
      } catch (error) {
        console.error("Failed to load trip state:", error);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [ably, tripId]);

  return state;
}
