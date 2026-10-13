import { randomInt } from "node:crypto";

/** No 0/O/1/l/I: the password is read aloud or copied off a screen. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;

/**
 * A temporary password for an account an administrator creates. Grouped for reading
 * aloud; 16 characters from this alphabet is well beyond the 12-character minimum.
 */
export function generateTemporaryPassword(): string {
  return Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
  ).join("-");
}
