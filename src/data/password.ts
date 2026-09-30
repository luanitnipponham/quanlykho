// Demo-mode password hashing: salted SHA-256 via WebCrypto, stored as "salt$hex".
// The production backend must use argon2id/bcrypt (docs/security.md §2.1); this only avoids keeping plaintext in the browser.

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomSalt(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function hashPassword(password: string, salt: string = randomSalt()): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return `${salt}$${toHex(digest)}`;
}

/** Re-hash `password` with the salt embedded in `stored` so the domain layer can compare strings. */
export function hashWithStoredSalt(password: string, stored: string): Promise<string> {
  const salt = stored.split('$')[0] ?? '';
  return hashPassword(password, salt);
}
