"use client";

import { useAbly } from "ably/react";
import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { useTripState } from "@/components/use-trip-state";
import { pinsChannelName } from "@/lib/channels";
import type { Destination } from "@/lib/trip-state";

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function isDestination(data: unknown): data is Destination {
  const d = data as Destination;
  return (
    typeof d === "object" &&
    d !== null &&
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    typeof d.lat === "number" &&
    typeof d.lng === "number"
  );
}

// MapLibre positions markers by setting transform on the root element, so the
// drop animation has to live on an inner wrapper.
function pinElement(destination: Destination, animate: boolean): HTMLElement {
  const root = document.createElement("div");
  const pin = document.createElement("div");
  pin.className = animate ? "wayfarer-pin wayfarer-pin-drop" : "wayfarer-pin";
  const dot = document.createElement("span");
  dot.className = "wayfarer-pin-dot";
  const label = document.createElement("span");
  label.className = "wayfarer-pin-label";
  label.textContent = destination.name;
  pin.append(dot, label);
  root.append(pin);
  return root;
}

// Destination pins on a world map. The durable pin set renders from
// LiveObjects state (so reload restores it); the trip's pins Pub/Sub channel
// carries the ephemeral placement events that drop pins in with an animation
// the moment the AI adds them.
export function MapView({ tripId }: { tripId: string }) {
  const ably = useAbly();
  const state = useTripState(tripId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  // False until the first LiveObjects snapshot has rendered: pins restored on
  // load appear in place, pins added after that drop in animated.
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [10, 30],
      zoom: 1,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    const markers = markersRef.current;
    return () => {
      markers.forEach((marker) => marker.remove());
      markers.clear();
      restoredRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  const fitToPins = useCallback(() => {
    const map = mapRef.current;
    const markers = [...markersRef.current.values()];
    if (!map || markers.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    markers.forEach((marker) => bounds.extend(marker.getLngLat()));
    map.fitBounds(bounds, { padding: 56, maxZoom: 8, duration: 900 });
  }, []);

  const addPin = useCallback(
    (destination: Destination, animate: boolean) => {
      const map = mapRef.current;
      if (!map || markersRef.current.has(destination.id)) return;
      const marker = new maplibregl.Marker({
        element: pinElement(destination, animate),
      })
        .setLngLat([destination.lng, destination.lat])
        .addTo(map);
      markersRef.current.set(destination.id, marker);
      fitToPins();
    },
    [fitToPins],
  );

  // Sync markers with the durable destination set in LiveObjects.
  useEffect(() => {
    if (!state) return;
    const destinations = state.destinations ?? {};
    markersRef.current.forEach((marker, id) => {
      if (!destinations[id]) {
        marker.remove();
        markersRef.current.delete(id);
        fitToPins();
      }
    });
    Object.values(destinations).forEach((destination) => {
      if (isDestination(destination)) {
        addPin(destination, restoredRef.current);
      }
    });
    restoredRef.current = true;
  }, [state, addPin, fitToPins]);

  // Drop pins the instant the AI announces them, ahead of (and deduped
  // against) the LiveObjects state sync.
  useEffect(() => {
    const channel = ably.channels.get(pinsChannelName(tripId));
    const onPin = (message: { data?: unknown }) => {
      if (isDestination(message.data)) {
        addPin(message.data, true);
      }
    };
    channel.subscribe("pin", onPin);
    return () => {
      channel.unsubscribe("pin", onPin);
    };
  }, [ably, tripId, addPin]);

  const empty = Object.keys(state?.destinations ?? {}).length === 0;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-xl">
      {/* Sized with h/w-full, not absolute inset-0: maplibre-gl.css forces
          the container to position:relative, which would zero its height. */}
      <div ref={containerRef} className="h-full w-full" />
      {empty && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
          <span className="rounded-full bg-white/90 px-3 py-1 text-xs text-zinc-500 shadow dark:bg-zinc-900/90 dark:text-zinc-400">
            Destination pins will appear here as the AI plans
          </span>
        </div>
      )}
    </div>
  );
}
