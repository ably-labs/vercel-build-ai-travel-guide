"use client";

import dynamic from "next/dynamic";
import { useContext } from "react";

import { RealtimeReadyContext } from "@/components/trip-realtime-provider";

function MapHint() {
  return (
    <div className="flex flex-1 items-center justify-center p-4 text-sm text-zinc-400 dark:text-zinc-500">
      Destination pins will appear here
    </div>
  );
}

// MapLibre touches the DOM at init, so the map view only loads in the
// browser; the realtime guard also keeps it from mounting before the Ably
// provider exists.
const MapView = dynamic(
  () => import("@/components/map-view").then((m) => m.MapView),
  { ssr: false, loading: MapHint },
);

export function MapPanel({ tripId }: { tripId: string }) {
  const ready = useContext(RealtimeReadyContext);
  if (!ready) {
    return <MapHint />;
  }
  return <MapView tripId={tripId} />;
}
