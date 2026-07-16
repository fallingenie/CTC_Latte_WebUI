export const ACCESS_SESSION_KEY = "ctc:beta-access";
export const ACCESS_PASSWORD_SHA256 = "7512f5336bf298156b486c61d5d62910ece816346cb3760691a39aa919277e5c";

const ACCESS_SESSION_VALUE = "granted-v1";

export async function sha256Hex(value, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle || typeof TextEncoder === "undefined") {
    throw new Error("secure-crypto-unavailable");
  }

  const bytes = new TextEncoder().encode(String(value));
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeHexEqual(left, right) {
  const leftText = typeof left === "string" ? left : "";
  const rightText = typeof right === "string" ? right : "";
  const maximumLength = Math.max(leftText.length, rightText.length);
  let difference = leftText.length ^ rightText.length;

  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (leftText.charCodeAt(index) || 0) ^ (rightText.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export async function verifyAccessPassword(candidate, cryptoProvider = globalThis.crypto) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const candidateDigest = await sha256Hex(candidate, cryptoProvider);
  return timingSafeHexEqual(candidateDigest, ACCESS_PASSWORD_SHA256);
}

export function isAccessGranted(storage) {
  const sessionStorage = resolveSessionStorage(storage);
  if (!sessionStorage) return false;

  try {
    return sessionStorage.getItem(ACCESS_SESSION_KEY) === ACCESS_SESSION_VALUE;
  } catch {
    return false;
  }
}

export function grantAccess(storage) {
  const sessionStorage = resolveSessionStorage(storage);
  if (!sessionStorage) return false;

  try {
    sessionStorage.setItem(ACCESS_SESSION_KEY, ACCESS_SESSION_VALUE);
    return true;
  } catch {
    return false;
  }
}

function resolveSessionStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}
