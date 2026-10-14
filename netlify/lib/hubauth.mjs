import { createHash } from "node:crypto";

// Shared auth for the Student Hub and the live classroom.
// Mentor: same password as the CRM (header x-crm-key, or "k" in a beacon body).
// Student: hub session token (Bearer header, or "t" in a beacon body).

const KEY_HASH = "2acd374aa638baece5951bc661972a3a3f941b082d49683f4064da31d304af8b";

export function keyOk(raw) {
  raw = String(raw || "").trim();
  if (!raw) return false;
  const env = process.env.CRM_KEY;
  if (env) return raw === env.trim();
  return createHash("sha256").update(raw).digest("hex") === KEY_HASH;
}

export function isAdmin(req, body = {}) {
  return keyOk(req.headers.get("x-crm-key") || body.k);
}

export async function studentFrom(req, store, body = {}) {
  const url = new URL(req.url);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || body.t || url.searchParams.get("t") || "";
  if (!token) return null;
  const auth = await store.get(`auth/${String(token).slice(0, 60)}`, { type: "json" });
  if (!auth || auth.exp < Date.now()) return null;
  return store.get(`students/${auth.id}`, { type: "json" });
}
