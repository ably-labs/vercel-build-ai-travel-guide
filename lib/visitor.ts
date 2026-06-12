// A stable per-browser identity. Auth is out of scope (any visitor with the
// trip link is a collaborator), but Ably tokens must carry a consistent
// clientId so presence and message authorship work across token renewals.
const STORAGE_KEY = "wayfarer:visitor-id";

export function getVisitorId(): string {
  if (typeof window === "undefined") {
    return "server";
  }
  let id = window.localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = `v-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
