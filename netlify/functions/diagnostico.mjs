import { getStore } from "@netlify/blobs";

// Public pre-diagnosis form. Each lead gets a private link with a random token
// (created from the CRM). Answers are saved on the lead's CRM record.

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

const TEXT = ["nome", "negocio", "setor", "equipe", "desafio", "repetitivas", "horas", "ia", "automatizar", "resultado", "valer"];
const LISTS = ["tempo", "ferramentas"];

export default async (req) => {
  const url = new URL(req.url);
  const forms = getStore({ name: "forms", consistency: "strong" });
  const crm = getStore({ name: "crm", consistency: "strong" });

  if (req.method === "GET") {
    const t = clip(url.searchParams.get("t"), 40);
    const f = t ? await forms.get(t, { type: "json" }) : null;
    if (!f) return json({ error: "link" }, 404);
    const cur = (await crm.get(f.id, { type: "json" })) || {};
    return json({ ok: true, done: !!cur.form });
  }

  if (req.method === "POST") {
    let b;
    try {
      b = await req.json();
    } catch {
      return json({ error: "invalid" }, 400);
    }
    const t = clip(b.t, 40);
    const f = t ? await forms.get(t, { type: "json" }) : null;
    if (!f) return json({ error: "link" }, 404);
    const a = b.answers || {};
    const form = { at: new Date().toISOString() };
    for (const k of TEXT) form[k] = clip(a[k], k === "nome" || k === "negocio" || k === "setor" ? 160 : 1200);
    for (const k of LISTS) form[k] = (Array.isArray(a[k]) ? a[k] : []).slice(0, 12).map((x) => clip(x, 60)).filter(Boolean);
    if (!form.nome || !form.desafio) return json({ error: "invalid" }, 400);
    const cur = (await crm.get(f.id, { type: "json" })) || {};
    await crm.setJSON(f.id, { ...cur, form, updatedAt: form.at });
    return json({ ok: true });
  }

  return json({ error: "method" }, 405);
};

export const config = { path: "/api/diagnostico" };
