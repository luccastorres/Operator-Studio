import { getStore } from "@netlify/blobs";

// Public onboarding form for new mentees (link sent in the welcome e-mail from the CRM).
// Store "onboard": <token> -> { id (CRM lead), who: "a" | "b", nome }. Answers go to the lead's CRM record: onboarding[who].

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const json = (d, s = 200) => Response.json(d, { status: s, headers: { "cache-control": "no-store" } });
export const ONB_TEXT = ["nome", "negocio", "vende", "equipeQuem", "dor", "repetitivas", "frustra", "tirar", "ias", "oito", "comecar", "trazer"];
export const ONB_ONE = ["equipe", "horas", "ia", "computador"];
export const ONB_LISTS = ["tempo", "ferramentas", "sistemas"];

export default async (req) => {
  const url = new URL(req.url);
  const ob = getStore({ name: "onboard", consistency: "strong" });
  const crm = getStore({ name: "crm", consistency: "strong" });
  const bookings = getStore({ name: "bookings", consistency: "strong" });

  if (req.method === "GET") {
    const t = clip(url.searchParams.get("t"), 40);
    const o = t ? await ob.get(t, { type: "json" }) : null;
    if (!o) return json({ error: "link" }, 404);
    const lead = { ...((await bookings.get(o.id, { type: "json" })) || {}), ...((await crm.get(o.id, { type: "json" })) || {}) };
    return json({ ok: true, nome: o.nome, negocio: lead.negocio || "", duo: !!lead.socioNome, done: !!lead.onboarding?.[o.who] });
  }

  if (req.method === "POST") {
    let b; try { b = await req.json(); } catch { return json({ error: "invalid" }, 400); }
    const t = clip(b.t, 40);
    const o = t ? await ob.get(t, { type: "json" }) : null;
    if (!o) return json({ error: "link" }, 404);
    const a = b.answers || {}, ans = { at: new Date().toISOString() };
    for (const k of ONB_TEXT) ans[k] = clip(a[k], k === "nome" || k === "negocio" ? 160 : 1500);
    for (const k of ONB_ONE) ans[k] = clip(a[k], 60);
    for (const k of ONB_LISTS) ans[k] = (Array.isArray(a[k]) ? a[k] : []).slice(0, 15).map((x) => clip(x, 60)).filter(Boolean);
    if (!ans.nome || !ans.dor) return json({ error: "invalid" }, 400);
    const cur = (await crm.get(o.id, { type: "json" })) || {};
    await crm.setJSON(o.id, { ...cur, onboarding: { ...(cur.onboarding || {}), [o.who]: ans }, updatedAt: ans.at });
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
};

export const config = { path: "/api/onboarding" };
