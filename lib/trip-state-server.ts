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

// Sum the price of every priced stop across the whole trip from the compact
// `days` view. This is the source of truth for the budget — the counter is
// only ever reconciled to match it, never accumulated independently.
function sumStopPrices(
  days: Record<string, Record<string, unknown>> | undefined,
): number {
  if (!days) return 0;
  let total = 0;
  for (const day of Object.values(days)) {
    for (const [key, value] of Object.entries(day)) {
      if (!key.startsWith("stop:")) continue;
      const stop = parseJsonLeaf<Stop>(value);
      if (stop?.price && stop.price > 0) total += stop.price;
    }
  }
  return total;
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

  // Count itinerary items (stops) across the whole plan, so the agent can
  // enforce the ≤10 cap before adding another.
  async countStops(): Promise<number> {
    const root = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const days = (root?.days ?? {}) as Record<string, DayJson>;
    let total = 0;
    for (const day of Object.values(days)) {
      for (const key of Object.keys(day)) {
        if (key.startsWith("stop:")) total += 1;
      }
    }
    return total;
  }

  // Whether a stop with this id already exists on the given day — used to tell
  // a replacing add_stop (idempotent, same id) from one that grows the plan.
  async hasStop(dayId: string, stopId: string): Promise<boolean> {
    const root = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const days = (root?.days ?? {}) as Record<string, Record<string, unknown>>;
    return days[dayId]?.[`stop:${stopId}`] !== undefined;
  }

  // Find an existing copy of the *same activity* somewhere other than the
  // target day. Stop ids are minted `${dayId}-${slug(name)}`, so re-adding an
  // activity that already lives on a different day mints a *different* id and
  // would leave the plan holding the same activity twice (AIT-951). We match
  // on the trailing name slug — the id with its `${dayId}-` prefix stripped —
  // and return the prior copy's day + full id so addStop can relocate it
  // instead of duplicating. Returns null if this activity isn't elsewhere.
  async findStopByName(
    targetDayId: string,
    nameSlug: string,
  ): Promise<{ dayId: string; stopId: string } | null> {
    if (!nameSlug) return null;
    const root = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const days = (root?.days ?? {}) as Record<string, Record<string, unknown>>;
    for (const [dayId, day] of Object.entries(days)) {
      if (dayId === targetDayId) continue;
      const match = `stop:${dayId}-${nameSlug}`;
      if (day[match] !== undefined) {
        return { dayId, stopId: `${dayId}-${nameSlug}` };
      }
    }
    return null;
  }

  // Add a stop to a day. The map key is the stop's id, so re-adding a stop
  // with the same id replaces it in place rather than duplicating the card.
  //
  // If the same activity already lives on a *different* day (`relocateFrom`),
  // we drop the prior copy in the same atomic batch as the new placement, so
  // the activity moves rather than appearing twice across the trip (AIT-951) —
  // the board never shows it duplicated mid-write.
  //
  // After writing we reconcile the budget to the sum of the trip's current
  // priced stops, so the total can never inflate from a re-add, retry, or
  // relocation — it always equals what's actually on the board. Returns the
  // stop's final id.
  async addStop(
    dayId: string,
    stop: Stop,
    relocateFrom?: { dayId: string; stopId: string },
  ): Promise<string> {
    const root = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const ops: RestObjectOperation[] = [];
    // Project the post-write state so the budget reconciles against exactly
    // what the board will hold once these ops apply.
    const days = { ...((root?.days ?? {}) as Record<string, Record<string, unknown>>) };
    if (relocateFrom && relocateFrom.dayId !== dayId) {
      ops.push({
        path: `days.${relocateFrom.dayId}`,
        mapRemove: { key: `stop:${relocateFrom.stopId}` },
      });
      const fromDay = { ...(days[relocateFrom.dayId] ?? {}) };
      delete fromDay[`stop:${relocateFrom.stopId}`];
      days[relocateFrom.dayId] = fromDay;
    }
    ops.push({
      path: `days.${dayId}`,
      mapSet: {
        key: `stop:${stop.id}`,
        value: { json: { ...stop } },
      },
    });
    days[dayId] = { ...(days[dayId] ?? {}), [`stop:${stop.id}`]: { ...stop } };
    const budgetOp = this.reconcileBudgetOp({ ...root, days });
    if (budgetOp) ops.push(budgetOp);
    await this.channel.object.publish(ops);
    return stop.id;
  }

  // Build a single counterInc op that moves the budget counter to exactly the
  // sum of the trip's current priced stops, or null if it's already correct.
  // Because the only counter primitive is increment (there's no set), we read
  // the live total and the live counter and emit the delta between them. This
  // makes the budget self-healing: after any change it equals the current
  // itinerary, never an accumulation of stale or duplicated adds.
  private reconcileBudgetOp(
    root: Record<string, unknown> | null,
  ): RestObjectOperation | null {
    const days = (root?.days ?? undefined) as
      | Record<string, Record<string, unknown>>
      | undefined;
    const target = sumStopPrices(days);
    const current = typeof root?.budget === "number" ? root.budget : 0;
    const delta = target - current;
    if (delta === 0) return null;
    return { path: "budget", counterInc: { number: delta } };
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
  // re-renders live from the LiveObjects update; the budget counter is
  // reconciled to the trip's current stop total so it stays correct even after
  // re-pricing. Returns null if the stop is gone.
  async updateStop(
    dayId: string,
    stopId: string,
    changes: Partial<Omit<Stop, "id">>,
  ): Promise<Stop | null> {
    const root = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const days = (root?.days ?? {}) as Record<string, Record<string, unknown>>;
    const current = parseJsonLeaf<Stop>(days[dayId]?.[`stop:${stopId}`]);
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
    const nextDays = {
      ...days,
      [dayId]: { ...(days[dayId] ?? {}), [`stop:${stopId}`]: { ...updated } },
    };
    const budgetOp = this.reconcileBudgetOp({ ...root, days: nextDays });
    if (budgetOp) ops.push(budgetOp);
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
    const root = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const days = (root?.days ?? {}) as Record<string, Record<string, unknown>>;
    const current = parseJsonLeaf<Stop>(days[fromDayId]?.[`stop:${stopId}`]);
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
    const fromDay = { ...(days[fromDayId] ?? {}) };
    delete fromDay[`stop:${stopId}`];
    const nextDays = {
      ...days,
      [fromDayId]: fromDay,
      [toDayId]: { ...(days[toDayId] ?? {}), [`stop:${stopId}`]: { ...updated } },
    };
    const budgetOp = this.reconcileBudgetOp({ ...root, days: nextDays });
    if (budgetOp) ops.push(budgetOp);
    await this.channel.object.publish(ops);
    return updated;
  }

  // Remove a stop from the schedule, refunding its price from the budget.
  // Returns the removed stop, or null if it wasn't there.
  async removeStop(dayId: string, stopId: string): Promise<Stop | null> {
    const root = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const days = (root?.days ?? {}) as Record<string, Record<string, unknown>>;
    const current = parseJsonLeaf<Stop>(days[dayId]?.[`stop:${stopId}`]);
    if (!current) return null;
    const ops: RestObjectOperation[] = [
      { path: `days.${dayId}`, mapRemove: { key: `stop:${stopId}` } },
    ];
    const nextDay = { ...(days[dayId] ?? {}) };
    delete nextDay[`stop:${stopId}`];
    const nextDays = { ...days, [dayId]: nextDay };
    const budgetOp = this.reconcileBudgetOp({ ...root, days: nextDays });
    if (budgetOp) ops.push(budgetOp);
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
