"use client";

import { useAbly } from "ably/react";
import type { Feature, FeatureCollection } from "geojson";
import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { useTripState } from "@/components/use-trip-state";
import { pinsChannelName } from "@/lib/channels";
import {
  placedStops,
  STOP_KIND_ICONS,
  type Destination,
  type PlacedStop,
} from "@/lib/trip-state";

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

const ROUTE_SOURCE = "wayfarer-route";

// One colour per day, cycled, used for both the stop badges and the route
// legs of that day.
const DAY_COLORS = [
  "#e11d48",
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

function dayColor(dayIndex: number): string {
  return DAY_COLORS[Math.abs(dayIndex - 1) % DAY_COLORS.length];
}

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

// A numbered badge per itinerary stop, coloured by day.
function stopElement(placed: PlacedStop, animate: boolean): HTMLElement {
  const root = document.createElement("div");
  const badge = document.createElement("div");
  badge.className = animate
    ? "wayfarer-stop wayfarer-stop-pop"
    : "wayfarer-stop";
  badge.style.background = dayColor(placed.dayIndex);
  badge.textContent = String(placed.order);
  badge.title = placed.stop.name;
  root.append(badge);
  return root;
}

function cardRow(parent: HTMLElement, label: string, value: string): void {
  const row = document.createElement("div");
  row.className = "wayfarer-card-row";
  const labelEl = document.createElement("span");
  labelEl.className = "wayfarer-card-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  parent.append(row);
}

// Popup card describing a stop: what, when, where, and cost.
function stopCard(placed: PlacedStop): HTMLElement {
  const { stop } = placed;
  const card = document.createElement("div");
  card.className = "wayfarer-card";

  const title = document.createElement("div");
  title.className = "wayfarer-card-title";
  title.textContent = `${STOP_KIND_ICONS[stop.kind] ?? "•"} ${stop.name}`;
  card.append(title);

  const day = document.createElement("div");
  day.className = "wayfarer-card-day";
  day.style.color = dayColor(placed.dayIndex);
  day.textContent = [placed.dayTitle ?? placed.dayId, stop.time]
    .filter(Boolean)
    .join(" · ");
  card.append(day);

  if (stop.location) cardRow(card, "Where", stop.location);
  if (typeof stop.price === "number") {
    cardRow(
      card,
      "Cost",
      stop.price > 0 ? `$${stop.price.toLocaleString()}` : "Free",
    );
  }
  if (stop.notes) cardRow(card, "Notes", stop.notes);
  return card;
}

// Route legs connecting stops in itinerary order: a solid day-coloured leg
// between consecutive stops of the same day, a dashed grey transfer between
// days.
function routeFeatures(placed: PlacedStop[]): FeatureCollection {
  const features: Feature[] = [];
  for (let i = 1; i < placed.length; i++) {
    const from = placed[i - 1];
    const to = placed[i];
    const sameDay = from.dayId === to.dayId;
    features.push({
      type: "Feature",
      properties: sameDay
        ? { leg: "day", color: dayColor(from.dayIndex) }
        : { leg: "transfer" },
      geometry: {
        type: "LineString",
        coordinates: [
          [from.stop.lng!, from.stop.lat!],
          [to.stop.lng!, to.stop.lat!],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

// Destinations, itinerary stops, and the route between them on a world map.
// Everything durable renders from LiveObjects state (so reload restores it);
// the trip's pins Pub/Sub channel carries the ephemeral placement events that
// drop destination pins in with an animation the moment the AI adds them.
export function MapView({ tripId }: { tripId: string }) {
  const ably = useAbly();
  const state = useTripState(tripId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const stopMarkersRef = useRef(
    new Map<string, { marker: maplibregl.Marker; json: string }>(),
  );
  // The route source can only be created once the style has loaded; state
  // updates that arrive earlier park their data here.
  const routeDataRef = useRef<FeatureCollection | null>(null);
  // False until the first LiveObjects snapshot has rendered: markers restored
  // on load appear in place, ones added after that animate in.
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
    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: routeDataRef.current ?? {
          type: "FeatureCollection",
          features: [],
        },
      });
      map.addLayer({
        id: "wayfarer-route-transfer",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["==", ["get", "leg"], "transfer"],
        paint: {
          "line-color": "#94a3b8",
          "line-width": 1.5,
          "line-dasharray": [1.5, 2],
        },
      });
      map.addLayer({
        id: "wayfarer-route-day",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["==", ["get", "leg"], "day"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.5,
          "line-opacity": 0.85,
        },
      });
    });
    mapRef.current = map;
    const markers = markersRef.current;
    const stopMarkers = stopMarkersRef.current;
    return () => {
      markers.forEach((marker) => marker.remove());
      markers.clear();
      stopMarkers.forEach(({ marker }) => marker.remove());
      stopMarkers.clear();
      restoredRef.current = false;
      routeDataRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  const fitToPins = useCallback(() => {
    const map = mapRef.current;
    const points = [
      ...[...markersRef.current.values()].map((m) => m.getLngLat()),
      ...[...stopMarkersRef.current.values()].map(({ marker }) =>
        marker.getLngLat(),
      ),
    ];
    if (!map || points.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    points.forEach((point) => bounds.extend(point));
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
  }, [state, addPin, fitToPins]);

  // Sync stop markers and the connecting route with the itinerary in
  // LiveObjects, in day-then-time order.
  useEffect(() => {
    const map = mapRef.current;
    if (!state || !map) return;
    const placed = placedStops(state.days ?? {});
    const byId = new Map(placed.map((p) => [p.stop.id, p]));
    const stopMarkers = stopMarkersRef.current;
    let changed = false;

    stopMarkers.forEach(({ marker }, id) => {
      if (!byId.has(id)) {
        marker.remove();
        stopMarkers.delete(id);
        changed = true;
      }
    });
    byId.forEach((placedStop, id) => {
      const json = JSON.stringify(placedStop);
      const existing = stopMarkers.get(id);
      if (existing?.json === json) return;
      existing?.marker.remove();
      const marker = new maplibregl.Marker({
        element: stopElement(placedStop, existing ? false : restoredRef.current),
      })
        .setLngLat([placedStop.stop.lng!, placedStop.stop.lat!])
        .setPopup(
          new maplibregl.Popup({
            offset: 14,
            closeButton: false,
            maxWidth: "280px",
            className: "wayfarer-popup",
          }).setDOMContent(stopCard(placedStop)),
        )
        .addTo(map);
      stopMarkers.set(id, { marker, json });
      changed = true;
    });

    routeDataRef.current = routeFeatures(placed);
    const source = map.getSource(ROUTE_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(routeDataRef.current);

    if (changed) fitToPins();
    restoredRef.current = true;
  }, [state, fitToPins]);

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

  const empty =
    Object.keys(state?.destinations ?? {}).length === 0 &&
    placedStops(state?.days ?? {}).length === 0;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-xl">
      {/* Sized with h/w-full, not absolute inset-0: maplibre-gl.css forces
          the container to position:relative, which would zero its height. */}
      <div ref={containerRef} className="h-full w-full" />
      {empty && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
          <span className="rounded-full bg-white/90 px-3 py-1 text-xs text-zinc-500 shadow dark:bg-zinc-900/90 dark:text-zinc-400">
            Destinations and itinerary stops will appear here as the AI plans
          </span>
        </div>
      )}
    </div>
  );
}
