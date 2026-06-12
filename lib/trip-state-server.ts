import Ably from "ably";
import { LiveObjects, type RestObjectOperation } from "ably/liveobjects";

import { stateChannelName } from "@/lib/channels";
import type { DayJson, Destination, Stop, TripMeta } from "@/lib/trip-state";

// REST compact reads return JSON-typed map values as their JSON-encoded
// string representation (unlike the realtime client's compactJson, which
// decodes them). Parse defensively so both shapes work.
function parseJsonLeaf<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

// Drop undefined entries so a partial update never erases existing fields.
function definedEntries<T extends object>(changes: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(changes).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

// A day's schedule as returned to the agent: fixed fields plus parsed stops.
export interface DaySchedule {
  dayId: string;
  title?: string;
  date?: string;
  index: number;
  stops: Stop[];
}

// Server-side writer for a trip's LiveObjects state. Uses the REST object
// API (stateless HTTP — right for a serverless route) with path-based,
// atomic batch operations.
export class TripStateWriter {
  private channel;

  constructor(tripId: string, apiKey: string) {
    const rest = new Ably.Rest({ key: apiKey, plugins: { LiveObjects } });
    this.channel = rest.channels.get(stateChannelName(tripId));
  }

  // Create the fixed top-level structure if this trip has never been written
  // to. Guarded by a read so re-running never replaces existing objects
  // (mapCreate at an occupied path would clobber it).
  async ensureInitialized(): Promise<void> {
    const current = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const ops: RestObjectOperation[] = [];
    if (!current || current.days === undefined) {
      ops.push({
        path: "days",
        mapCreate: { semantics: "lww", entries: {} },
      });
    }
    if (!current || current.destinations === undefined) {
      ops.push({
        path: "destinations",
        mapCreate: { semantics: "lww", entries: {} },
      });
    }
    if (!current || current.budget === undefined) {
      ops.push({ path: "budget", counterCreate: { count: 0 } });
    }
    if (ops.length > 0) {
      await this.channel.object.publish(ops);
    }
  }

  async setMeta(meta: TripMeta): Promise<void> {
    await this.channel.object.publish({
      path: "",
      mapSet: { key: "meta", value: { json: { ...meta } } },
    });
  }

  async addDay(
    dayId: string,
    index: number,
    title: string,
    date?: string,
  ): Promise<void> {
    await this.channel.object.publish({
      path: `days.${dayId}`,
      mapCreate: {
        semantics: "lww",
        entries: {
          title: { data: { string: title } },
          index: { data: { number: index } },
          ...(date ? { date: { data: { string: date } } } : {}),
        },
      },
    });
  }

  async addStop(dayId: string, stop: Stop): Promise<void> {
    const ops: RestObjectOperation[] = [
      {
        path: `days.${dayId}`,
        mapSet: {
          key: `stop:${stop.id}`,
          value: { json: { ...stop } },
        },
      },
    ];
    if (stop.price && stop.price > 0) {
      ops.push({ path: "budget", counterInc: { number: stop.price } });
    }
    await this.channel.object.publish(ops);
  }

  // Read a single stop's current value, or null if the day/stop is missing.
  private async readStop(dayId: string, stopId: string): Promise<Stop | null> {
    try {
      const day = (await this.channel.object.get({
        path: `days.${dayId}`,
      })) as Record<string, unknown> | null;
      return parseJsonLeaf<Stop>(day?.[`stop:${stopId}`]);
    } catch {
      return null;
    }
  }

  // The full itinerary in day order with parsed stops — lets the agent see
  // the current schedule (and real stop ids) before revising it.
  async getSchedule(): Promise<DaySchedule[]> {
    const root = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const days = (root?.days ?? {}) as Record<string, DayJson>;
    return Object.entries(days)
      .map(([dayId, day]) => ({
        dayId,
        title: day.title != null ? String(day.title) : undefined,
        date: day.date != null ? String(day.date) : undefined,
        index: typeof day.index === "number" ? day.index : 0,
        stops: Object.entries(day)
          .filter(([key]) => key.startsWith("stop:"))
          .flatMap(([, value]) => {
            const stop = parseJsonLeaf<Stop>(value);
            return stop ? [stop] : [];
          })
          .sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99")),
      }))
      .sort((a, b) => a.index - b.index);
  }

  // Revise an existing stop in place (retime, reprice, rename...). The board
  // re-renders live from the LiveObjects update; the budget counter moves by
  // the price delta so totals stay correct. Returns null if the stop is gone.
  async updateStop(
    dayId: string,
    stopId: string,
    changes: Partial<Omit<Stop, "id">>,
  ): Promise<Stop | null> {
    const current = await this.readStop(dayId, stopId);
    if (!current) return null;
    const updated: Stop = {
      ...current,
      ...definedEntries(changes),
      id: current.id,
    };
    const ops: RestObjectOperation[] = [
      {
        path: `days.${dayId}`,
        mapSet: { key: `stop:${stopId}`, value: { json: { ...updated } } },
      },
    ];
    const priceDelta = (updated.price ?? 0) - (current.price ?? 0);
    if (priceDelta !== 0) {
      ops.push({ path: "budget", counterInc: { number: priceDelta } });
    }
    await this.channel.object.publish(ops);
    return updated;
  }

  // Move a stop to a different day (optionally revising it on the way) as a
  // single atomic batch, so the board never shows it duplicated or missing
  // mid-move. Returns null if the stop isn't on the source day.
  async moveStop(
    fromDayId: string,
    toDayId: string,
    stopId: string,
    changes: Partial<Omit<Stop, "id">> = {},
  ): Promise<Stop | null> {
    if (fromDayId === toDayId) {
      return this.updateStop(fromDayId, stopId, changes);
    }
    const current = await this.readStop(fromDayId, stopId);
    if (!current) return null;
    const updated: Stop = {
      ...current,
      ...definedEntries(changes),
      id: current.id,
    };
    const ops: RestObjectOperation[] = [
      { path: `days.${fromDayId}`, mapRemove: { key: `stop:${stopId}` } },
      {
        path: `days.${toDayId}`,
        mapSet: { key: `stop:${stopId}`, value: { json: { ...updated } } },
      },
    ];
    const priceDelta = (updated.price ?? 0) - (current.price ?? 0);
    if (priceDelta !== 0) {
      ops.push({ path: "budget", counterInc: { number: priceDelta } });
    }
    await this.channel.object.publish(ops);
    return updated;
  }

  // Remove a stop from the schedule, refunding its price from the budget.
  // Returns the removed stop, or null if it wasn't there.
  async removeStop(dayId: string, stopId: string): Promise<Stop | null> {
    const current = await this.readStop(dayId, stopId);
    if (!current) return null;
    const ops: RestObjectOperation[] = [
      { path: `days.${dayId}`, mapRemove: { key: `stop:${stopId}` } },
    ];
    if (current.price && current.price > 0) {
      ops.push({ path: "budget", counterInc: { number: -current.price } });
    }
    await this.channel.object.publish(ops);
    return current;
  }

  // Re-title or re-date an existing day (e.g. when the whole trip shifts).
  async updateDay(
    dayId: string,
    changes: { title?: string; date?: string },
  ): Promise<void> {
    const ops: RestObjectOperation[] = [];
    if (changes.title !== undefined) {
      ops.push({
        path: `days.${dayId}`,
        mapSet: { key: "title", value: { string: changes.title } },
      });
    }
    if (changes.date !== undefined) {
      ops.push({
        path: `days.${dayId}`,
        mapSet: { key: "date", value: { string: changes.date } },
      });
    }
    if (ops.length > 0) {
      await this.channel.object.publish(ops);
    }
  }

  async addDestination(destination: Destination): Promise<void> {
    await this.channel.object.publish({
      path: "destinations",
      mapSet: {
        key: destination.id,
        value: { json: { ...destination } },
      },
    });
  }
}
