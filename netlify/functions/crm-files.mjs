import { getStore } from "@netlify/blobs";
import { isAdmin } from "../lib/hubauth.mjs";

// Files attached to a CRM lead (reports, proposals, contracts).
// Store "crmfiles": <fid> -> bytes (metadata: name, type, lead). The list lives in the lead's CRM meta as `files`.
const json = (d, s = 200) => Response.json(d, { status: s, headers: { "cache-control": "no-store" } });
const clip = (v, n) => String(v ?? "").trim().slice(0, n);

export default async (req) => {
  if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const fid = url.pathname.split("/").pop();
  const files = getStore({ name: "crmfiles", consistency: "strong" });
  const crm = getStore({ name: "crm", consistency: "strong" });

  if (req.method === "GET" && fid && fid !== "crm-files") {
    const r = await files.getWithMetadata(fid, { type: "arrayBuffer" });
    if (!r) return json({ error: "nf" }, 404);
    const name = r.metadata?.name || "arquivo";
    return new Response(r.data, { headers: { "content-type": r.metadata?.type || "application/octet-stream", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`, "cache-control": "private, no-store" } });
  }

  if (req.method === "POST") {
    const id = clip(url.searchParams.get("id"), 60);
    if (!id) return json({ error: "id" }, 400);
    if (url.searchParams.get("del")) {
      const d = clip(url.searchParams.get("del"), 40);
      const cur = (await crm.get(id, { type: "json" })) || {};
      await files.delete(d);
      await crm.setJSON(id, { ...cur, files: (cur.files || []).filter((f) => f.fid !== d) });
      return json({ ok: true });
    }
    const name = clip(url.searchParams.get("name") || "arquivo", 120);
    const type = clip(req.headers.get("content-type") || "application/octet-stream", 100);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 5.5 * 1024 * 1024) return json({ error: "size" }, 400);
    const newId = "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await files.set(newId, buf, { metadata: { name, type, lead: id } });
    const cur = (await crm.get(id, { type: "json" })) || {};
    const entry = { fid: newId, name, size: buf.byteLength, at: new Date().toISOString() };
    await crm.setJSON(id, { ...cur, files: [entry, ...(cur.files || [])].slice(0, 50) });
    return json({ ok: true, file: entry });
  }
  return json({ error: "method" }, 405);
};

export const config = { path: ["/api/crm-files", "/api/crm-files/*"] };
