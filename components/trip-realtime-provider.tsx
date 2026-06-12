"use client";

import Ably from "ably";
import { LiveObjects } from "ably/liveobjects";
import { AblyProvider } from "ably/react";
import { createContext, useEffect, useState } from "react";

import { getVisitorId } from "@/lib/visitor";

// True once the Ably client exists and AblyProvider is mounted. Components
// that use ably/react hooks must check this before calling them, because the
// client is only created in the browser — during SSR and the first client
// render there is no provider above them.
export const RealtimeReadyContext = createContext(false);

// Creates the single Ably Realtime connection for the page. Created in
// useEffect (never at module scope or during render) so SSR doesn't open
// connections and React strict-mode double-mounts don't leak them. Children
// render immediately either way, so the static canvas server-renders.
export function TripRealtimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client, setClient] = useState<Ably.Realtime | null>(null);

  useEffect(() => {
    // Note: echoMessages must stay enabled — AI Transport anchors a run's
    // view to the triggering input event, so suppressing the echo of our own
    // published messages breaks the live conversation view.
    const realtime = new Ably.Realtime({
      authUrl: "/api/ably/token",
      authParams: { clientId: getVisitorId() },
      plugins: { LiveObjects },
    });
    // Mount-only external-system connection: state must be set from the
    // effect because the client cannot be created during SSR or render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClient(realtime);
    return () => {
      realtime.close();
    };
  }, []);

  if (!client) {
    return (
      <RealtimeReadyContext.Provider value={false}>
        {children}
      </RealtimeReadyContext.Provider>
    );
  }

  return (
    <RealtimeReadyContext.Provider value={true}>
      <AblyProvider client={client}>{children}</AblyProvider>
    </RealtimeReadyContext.Provider>
  );
}
