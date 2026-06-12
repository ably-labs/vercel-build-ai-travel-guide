// Trip IDs are shareable URL slugs. Visiting a fresh ID simply creates that
// trip — there is no registry to insert into, since all trip state lives in
// Ably channels namespaced by the ID.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newTripId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = "";
  for (const byte of bytes) {
    id += ALPHABET[byte % ALPHABET.length];
  }
  return id;
}

export function isValidTripId(id: string): boolean {
  return /^[a-z0-9]{4,32}$/.test(id);
}
