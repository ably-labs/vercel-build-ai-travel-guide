"use client";

import { useClientSession } from "@ably/ai-transport/vercel/react";
import { useEffect, useState } from "react";

import { sessionChannelName } from "@/lib/channels";
import type { TripStateJson } from "@/lib/trip-state";

// Subscribe to a trip's LiveObjects state and re-render on every change. Read
// through the session's `object` accessor, so it shares the trip's session
// channel.
//
// Must be used under the trip's `ChatTransportProvider` (mounted once the
// realtime client is ready).
export function useTripState(tripId: string): TripStateJson | null {
  const { session, sessionError } = useClientSession({
    channelName: sessionChannelName(tripId),
  });
  const [state, setState] = useState<TripStateJson | null>(null);

  useEffect(() => {
    // No usable session (no provider, or construction failed): nothing to read.
    if (sessionError) return;
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | undefined;

    (async () => {
      try {
        // object.get() implicitly attaches, so this is safe before connect() resolves.
        const root = await session.object.get();
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
  }, [session, sessionError]);

  return state;
}
