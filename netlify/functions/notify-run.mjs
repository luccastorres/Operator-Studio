import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { processBooking } from "../lib/notify.mjs";

// Owner-only: run pending confirmations/reminders now. GET /api/notify-run?k=<calendar token>
const TOKEN_HASH = "7a38aeb9e5d1dae8429d00e1e3c92ddf5636c0fd3523b52d386b42ecd3810896";

export default async (req) => {
  const k = new URL(req.url).searchParams.get("k") || "";
  if (createHash("sha256").update(k).digest("hex") !== TOKEN_HASH) return new Response("Not found", { status: 404 });
  const store = getStore({ name: "bookings", consistency: "strong" });
  const { blobs } = await store.list();
  const out = {};
  for (const b of blobs) {
    out[b.key] = await processBooking(store, b.key);
    const r = await store.get(b.key, { type: "json" });
    out[b.key] += ` · ${r?.nome || ""} · meet:${r?.meet ? "yes" : "no"}${r?.lastError ? " · err:" + r.lastError : ""}`;
  }
  return Response.json(out, { headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/notify-run" };
