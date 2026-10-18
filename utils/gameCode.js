import { randomInt } from "node:crypto";
import { HttpError } from "./HttpError.js";

const CODE_RE = /^[A-Z0-9]{6}$/;
// No 0/O or 1/I so codes are easy to read aloud
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateGameCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++)
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

// Uppercases a code from the URL and rejects anything that can't be a real code.
export function normalizeGameCode(value) {
  const code = String(value).toUpperCase();
  if (!CODE_RE.test(code)) throw new HttpError(404, "Game not found");
  return code;
}
