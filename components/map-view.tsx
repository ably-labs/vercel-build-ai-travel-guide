"use client";

import type { Feature, FeatureCollection } from "geojson";
import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { useSelectedStop } from "@/components/selected-stop";
import { useTripState } from "@/components/use-trip-state";
import {
  LANDMARK_MIN_ZOOM,
  placedStops,
  STOP_KIND_ICONS,
  type Destination,
  type PlacedStop,
  type SuggestedLandmark,
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
// legs of that day. Drawn from the Ably secondary palette (the brand's
// designated colour-coding / data-visualisation set), led by Ably Orange so
// day one carries the signature brand colour. See https://brand.ably.com/#colours.
const DAY_COLORS = [
  "#ff5416", // Orange 600 (signature)
  "#00a5ec", // Blue 600
  "#008e06", // Green 700
  "#f8c100", // Yellow 500
  "#7a1bf2", // Violet 500
  "#0284cd", // Blue 700
  "#d400ab", // Pink 600
  "#00c008", // Green 600
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

function isLandmark(data: unknown): data is SuggestedLandmark {
  const l = data as SuggestedLandmark;
  return (
    typeof l === "object" &&
    l !== null &&
    typeof l.id === "string" &&
    typeof l.name === "string" &&
    typeof l.lat === "number" &&
    typeof l.lng === "number"
  );
}

// A suggested-landmark pin: a small teardrop marker with the place name. It's
// deliberately lighter than a destination pin — these are optional ideas, not
// the trip's anchor cities. Shown only when the map is zoomed in (see
// LANDMARK_MIN_ZOOM); the marker root toggles visibility from the zoom handler.
function landmarkElement(landmark: SuggestedLandmark): HTMLElement {
  const root = document.createElement("div");
  root.className = "wayfarer-landmark";
  const marker = document.createElement("span");
  marker.className = "wayfarer-landmark-pin";
  const label = document.createElement("span");
  label.className = "wayfarer-landmark-label";
  label.textContent = landmark.name;
  root.append(marker, label);
  if (landmark.blurb) root.title = `${landmark.name} — ${landmark.blurb}`;
  else root.title = landmark.name;
  return root;
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
// Everything renders from the trip's LiveObjects state, so a reload restores
// it and the pin-drop animation rides the same state changes (see the
// destination sync below).
//
// The map's center/zoom live in the MapLibre instance, which stays mounted
// while the surrounding panel animates between its grid cell and a
// full-viewport overlay (see MapPanel), so the view is preserved across the
// expand / collapse for free. A ResizeObserver keeps the map's internal
// viewport in lockstep with its container as that box animates.
export function MapView({ tripId }: { tripId: string }) {
  const state = useTripState(tripId);
  const { selectedStopId, selectNonce, selectStop } = useSelectedStop();
  // Latest selectStop, read inside marker click handlers so we can attach them
  // once at marker-creation time without re-creating markers on every render.
  const selectStopRef = useRef(selectStop);
  useEffect(() => {
    selectStopRef.current = selectStop;
  }, [selectStop]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const stopMarkersRef = useRef(
    new Map<string, { marker: maplibregl.Marker; json: string }>(),
  );
  // Suggested-landmark markers, kept hidden until the map is zoomed in past
  // LANDMARK_MIN_ZOOM (see the zoom effect). Their elements stay mounted; only
  // their `hidden` flag toggles, so revealing them on zoom is instant.
  const landmarkMarkersRef = useRef(
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
          "line-color": "#a7b1be", // Ably Neutral 600
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

    // Reveal or hide the suggested-landmark pins as the user crosses the zoom
    // threshold. Below it the map shows whole countries, where landmarks would
    // be clutter; from city-scale up they help the traveller spot what's
    // nearby. Toggling the marker root's `hidden` flag (rather than
    // adding/removing markers) keeps the reveal instant and lets the CSS fade
    // them in. Fires on every zoom frame, so the threshold crossing is caught
    // whichever direction the user zooms.
    const syncLandmarkVisibility = () => {
      const visible = map.getZoom() >= LANDMARK_MIN_ZOOM;
      landmarkMarkersRef.current.forEach(({ marker }) => {
        marker.getElement().classList.toggle("wayfarer-landmark-shown", visible);
      });
    };
    map.on("zoom", syncLandmarkVisibility);

    // Keep the map's internal size in sync with its container. The expand /
    // collapse animation changes the container's box over ~300ms; without
    // this, MapLibre keeps its old viewport size and renders stretched tiles
    // and gray gaps until something else triggers a resize. A ResizeObserver
    // fires on every intermediate frame of the transition, so the map grows
    // and shrinks smoothly in step with its box. It also covers the responsive
    // layout reflowing the grid (AIT-943).
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    const markers = markersRef.current;
    const stopMarkers = stopMarkersRef.current;
    const landmarkMarkers = landmarkMarkersRef.current;
    return () => {
      map.off("zoom", syncLandmarkVisibility);
      resizeObserver.disconnect();
      markers.forEach((marker) => marker.remove());
      markers.clear();
      stopMarkers.forEach(({ marker }) => marker.remove());
      stopMarkers.clear();
      landmarkMarkers.forEach(({ marker }) => marker.remove());
      landmarkMarkers.clear();
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

  // Sync markers with the destination set in LiveObjects. Destinations in the
  // first snapshot restore in place; ones that arrive later animate in
  // (restoredRef gates this). addPin no-ops on an existing marker, so a
  // re-delivered snapshot never re-animates a pin.
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
      const element = stopElement(placedStop, existing ? false : restoredRef.current);
      // Route marker clicks through stop selection rather than MapLibre's
      // default popup toggle, so opening a card on the map closes any other
      // open card too (the selection effect enforces one-open-at-a-time).
      // Capture phase + stopPropagation prevents MapLibre's own click-to-toggle.
      element.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
          selectStopRef.current(placedStop.stop.id);
        },
        true,
      );
      const marker = new maplibregl.Marker({ element })
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

  // Fly to a stop when it's selected in the day board, and open its popup.
  // Keyed on selectNonce (not just the id) so re-clicking the same row
  // re-centres the map. The stop's marker is the source of truth for its
  // coordinates, so this naturally waits for the marker to exist (the state
  // sync above creates it) and no-ops for stops without a placed marker. If the
  // map is mid-fly to another stop, flyTo cancels the in-flight animation.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStopId) return;
    const entry = stopMarkersRef.current.get(selectedStopId);
    if (!entry) return;
    const lngLat = entry.marker.getLngLat();
    map.flyTo({
      center: lngLat,
      zoom: Math.max(map.getZoom(), 13),
      duration: 900,
      essential: true,
    });
    // Only one stop card is shown at a time: close any other open popups
    // before opening the selected stop's, so cards replace rather than stack.
    stopMarkersRef.current.forEach((other, id) => {
      if (id === selectedStopId) return;
      const otherPopup = other.marker.getPopup();
      if (otherPopup?.isOpen()) other.marker.togglePopup();
    });
    const popup = entry.marker.getPopup();
    if (popup && !popup.isOpen()) entry.marker.togglePopup();
    // selectNonce makes a repeat select re-trigger; state is included so a
    // select that lands just before the marker exists re-runs once it does.
  }, [selectedStopId, selectNonce, state]);

  // Sync suggested-landmark markers with the durable landmark set in
  // LiveObjects. New or changed pins are (re)created with the visibility that
  // matches the map's current zoom, so a landmark suggested while already
  // zoomed in shows immediately, and one suggested at the world view stays
  // hidden until the user zooms to it. The zoom handler above keeps the whole
  // set in step thereafter.
  useEffect(() => {
    const map = mapRef.current;
    if (!state || !map) return;
    const landmarks = state.landmarks ?? {};
    const landmarkMarkers = landmarkMarkersRef.current;
    const shown = map.getZoom() >= LANDMARK_MIN_ZOOM;

    landmarkMarkers.forEach(({ marker }, id) => {
      if (!landmarks[id]) {
        marker.remove();
        landmarkMarkers.delete(id);
      }
    });
    Object.values(landmarks).forEach((landmark) => {
      if (!isLandmark(landmark)) return;
      const json = JSON.stringify(landmark);
      const existing = landmarkMarkers.get(landmark.id);
      if (existing?.json === json) return;
      existing?.marker.remove();
      const element = landmarkElement(landmark);
      if (shown) element.classList.add("wayfarer-landmark-shown");
      const marker = new maplibregl.Marker({ element })
        .setLngLat([landmark.lng, landmark.lat])
        .addTo(map);
      landmarkMarkers.set(landmark.id, { marker, json });
    });
  }, [state]);

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
          <span className="wayfarer-empty-hint rounded-full bg-white/90 px-3 py-1 text-xs text-zinc-500 shadow dark:bg-zinc-900/90 dark:text-zinc-400">
            Destinations and itinerary stops will appear here as the AI plans
          </span>
        </div>
      )}
    </div>
  );
}
