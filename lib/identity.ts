// Deterministic collaborator identity derived from a clientId.
//
// Auth is out of scope (anyone with the link is a collaborator), so each
// participant gets a stable identity derived purely from their clientId.
// Every browser derives the same name, initials, and colour for a given
// clientId, so nothing identity-related needs to travel on the wire — the
// nav-bar presence avatars and the chat message attribution both call
// identityFor() and therefore agree on how each person looks.
const ADJECTIVES = [
  "Amber",
  "Brisk",
  "Coral",
  "Dusty",
  "Eager",
  "Fabled",
  "Gilded",
  "Hardy",
  "Indigo",
  "Jolly",
  "Keen",
  "Lucky",
  "Mellow",
  "Nimble",
  "Plucky",
  "Roving",
];

const TRAVELLERS = [
  "Albatross",
  "Bison",
  "Caravan",
  "Drifter",
  "Explorer",
  "Falcon",
  "Gull",
  "Heron",
  "Ibis",
  "Jetsetter",
  "Kestrel",
  "Lynx",
  "Mariner",
  "Nomad",
  "Osprey",
  "Pilgrim",
];

const COLORS = [
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
  "#ec4899", // pink
  "#6366f1", // indigo
];

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface CollaboratorIdentity {
  /** Two-word display name, e.g. "Amber Albatross". */
  name: string;
  /** Two-letter initials for compact avatars, e.g. "AA". */
  initials: string;
  /** Stable avatar colour (hex) for this clientId. */
  color: string;
}

export function identityFor(clientId: string): CollaboratorIdentity {
  const hash = hashOf(clientId);
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const traveller = TRAVELLERS[Math.floor(hash / 16) % TRAVELLERS.length];
  return {
    name: `${adjective} ${traveller}`,
    initials: `${adjective[0]}${traveller[0]}`,
    color: COLORS[hash % COLORS.length],
  };
}
