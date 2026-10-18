import { getStore } from "@netlify/blobs";
import { isAdmin } from "../lib/hubauth.mjs";
import { buildCallReport } from "../lib/callreport.mjs";

// Background job: report of an analysis call from its transcript. Returns 202 at once.
export default async (req) => {
  let body = {};
  try { body = await req.json(); } catch {}
  if (!isAdmin(req, body)) return;
  const id = String(body.id || "").slice(0, 60);
  if (!id) return;
  const s = (name) => getStore({ name, consistency: "strong" });
  await buildCallReport(s("crm"), s("calls"), s("bookings"), id);
};

export const config = { path: "/api/crm-call", background: true };
