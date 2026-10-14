import { getStore } from "@netlify/blobs";
import { isAdmin } from "../lib/hubauth.mjs";
import { buildReport } from "../lib/report.mjs";

// Background job: builds the class report with Claude (can take a minute on a long class).
// Called by the classroom page or the mentor panel. Returns 202 at once; the result lands in reports/<start>.
export default async (req) => {
  let body = {};
  try { body = await req.json(); } catch {}
  if (!isAdmin(req, body)) return;
  const start = String(body.start || "").slice(0, 40);
  if (!start) return;
  const store = getStore({ name: "hub", consistency: "strong" });
  await buildReport(store, start);
};

export const config = { path: "/api/live-report", background: true };
