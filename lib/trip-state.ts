// The shape of a trip's canvas state, as seen through the LiveObjects
// compact-JSON view. The durable source of truth lives on the
// trip:{tripId}:state channel:
//
//   root (map)
//   ├── meta            JSON { title, summary }
//   ├── days (map)      key day-{n} → day map
//   │     └── day map   { title, date?, index, stop:{stopId} → JSON Stop... }
//   ├── destinations    (map) key id → JSON Destination
//   └── budget          (counter) running total in whole USD
//
// Stops are JSON leaf values keyed `stop:{id}` inside their day's map, so
// adding a stop is a single conflict-free mapSet and the board re-renders
// per-stop as the AI writes.

// Upper bound on the number of itinerary items (stops) in a single plan.
// Over-stuffed itineraries read as noise; we keep the most popular stops and
// cap the total. This is a ceiling, not a target — short trips have fewer.
export const MAX_ITINERARY_ITEMS = 10;

export type StopKind =
  | "flight"
  | "hotel"
  | "activity"
  | "food"
  | "transport"
  | "sight";

export interface Stop {
  id: string;
  name: string;
  kind: StopKind;
  time?: string;
  location?: string;
  price?: number;
  notes?: string;
  lat?: number;
  lng?: number;
}

export const STOP_KIND_ICONS: Record<StopKind, string> = {
  flight: "✈️",
  hotel: "🛏️",
  activity: "🎟️",
  food: "🍽️",
  transport: "🚆",
  sight: "📍",
};

// Human-readable budget category labels. Flights and ground transport both
// roll up under "Travel" so the breakdown reads as a handful of intuitive
// spending buckets rather than the raw stop taxonomy.
export const STOP_KIND_LABELS: Record<StopKind, string> = {
  flight: "Travel",
  transport: "Travel",
  hotel: "Lodging",
  food: "Food",
  activity: "Activities",
  sight: "Sights",
};

export interface Destination {
  id: string;
  name: string;
  country?: string;
  lat: number;
  lng: number;
}

export interface TripMeta {
  title?: string;
  summary?: string;
}

// A day as it appears in the compact JSON view: fixed fields plus
// `stop:{id}` entries.
export interface DayJson {
  title?: string;
  date?: string;
  index?: number;
  [stopKey: string]: unknown;
}

export interface TripStateJson {
  meta?: TripMeta;
  days?: Record<string, DayJson>;
  destinations?: Record<string, Destination>;
  budget?: number;
}

// One row of the budget breakdown: a spending category, its summed expected
// cost across all priced stops, and how many stops contributed.
export interface BudgetCategory {
  label: string;
  total: number;
  count: number;
}

// Group the trip's priced stops into spending categories (via STOP_KIND_LABELS)
// and sum each. Returned highest-spend first; the per-category totals always
// sum to the overall budget total derived from the same priced stops. Stops
// without a positive numeric price are ignored, matching the budget counter.
export function budgetByCategory(
  days: Record<string, DayJson> | undefined,
): BudgetCategory[] {
  if (!days) {
    return [];
  }
  const byLabel = new Map<string, BudgetCategory>();
  for (const [, day] of sortedDays(days)) {
    for (const stop of stopsOfDay(day)) {
      if (typeof stop.price !== "number" || stop.price <= 0) {
        continue;
      }
      const label = STOP_KIND_LABELS[stop.kind] ?? "Other";
      const row = byLabel.get(label) ?? { label, total: 0, count: 0 };
      row.total += stop.price;
      row.count += 1;
      byLabel.set(label, row);
    }
  }
  return [...byLabel.values()].sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label),
  );
}

export function stopsOfDay(day: DayJson): Stop[] {
  return Object.entries(day)
    .filter(([key]) => key.startsWith("stop:"))
    .map(([, value]) => value as Stop)
    .sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
}

export function sortedDays(
  days: Record<string, DayJson>,
): Array<[string, DayJson]> {
  return Object.entries(days).sort(
    ([, a], [, b]) => (a.index ?? 0) - (b.index ?? 0),
  );
}

// A stop with map coordinates, placed in overall itinerary order (day order,
// then time order within the day). `order` is 1-based across the whole trip.
export interface PlacedStop {
  stop: Stop;
  dayId: string;
  dayIndex: number;
  dayTitle?: string;
  order: number;
}

export function placedStops(days: Record<string, DayJson>): PlacedStop[] {
  const placed: PlacedStop[] = [];
  for (const [dayId, day] of sortedDays(days)) {
    for (const stop of stopsOfDay(day)) {
      if (typeof stop.lat !== "number" || typeof stop.lng !== "number") {
        continue;
      }
      placed.push({
        stop,
        dayId,
        dayIndex: day.index ?? 0,
        dayTitle: day.title != null ? String(day.title) : undefined,
        order: placed.length + 1,
      });
    }
  }
  return placed;
}
