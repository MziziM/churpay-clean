// frontend/src/auth.js

const KEY = "churpay_auth";

/** returns true if a token exists */
export function isAuthed() {
  return !!localStorage.getItem(KEY);
}

/** simple demo login.
 * If VITE_ADMIN_PASS is set, require exact match.
 * Otherwise accept "letmein" for local dev.
 */
export function login(pass) {
  const expected = (import.meta.env.VITE_ADMIN_PASS || "letmein").trim();
  if (!pass || pass.trim() !== expected) return false;
  localStorage.setItem(KEY, "ok");
  return true;
}

export function logout() {
  localStorage.removeItem(KEY);
}