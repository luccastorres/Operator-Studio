import { getStore } from "@netlify/blobs";
import { createHash, randomBytes } from "node:crypto";
import { followupEmail, sendFollowup } from "../lib/followup.mjs";

// Private CRM API for Operator Studio.
// Leads = every booking from the site (store "bookings") + leads added by hand.
// Pipeline data (stage, notes, value) lives in store "crm", keyed by lead id.

const STAGES = ["novo", "agendado", "analise", "proposta", "cliente", "perdido"];
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

// SHA-256 of the CRM password (the password itself is not stored in the repo).
// To change it, set CRM_KEY in Netlify env vars, or replace this hash.
const KEY_HASH = "2acd374aa638baece5951bc661972a3a3f941b082d49683f4064da31d304af8b";
// Minutes Italy is ahead of UTC on that local date/time.
function romeOffsetMin(slot) {
  const guess = new Date(`${slot}:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const g = (t) => +parts.find((x) => x.type === t).value;
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return Math.round((asUtc - guess.getTime()) / 60000);
}
const sha = (v) => createHash("sha256").update(v).digest("hex");

function authorized(req) {
  const raw = String(req.headers.get("x-crm-key") || "").trim();
  if (!raw) return false;
  const env = process.env.CRM_KEY;
  // Once CRM_KEY is set in Netlify, only that password works (exact match).
  if (env) return raw === env.trim();
  const given = raw;
  return sha(given) === KEY_HASH;
}

export default async (req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  const bookings = getStore({ name: "bookings", consistency: "strong" });
  const crm = getStore({ name: "crm", consistency: "strong" });

  if (req.method === "GET") {
    const [{ blobs: bk }, { blobs: cm }] = await Promise.all([bookings.list(), crm.list()]);
    const meta = {};
    await Promise.all(cm.map(async (b) => (meta[b.key] = await crm.get(b.key, { type: "json" }))));

    const leads = [];
    await Promise.all(
      bk.map(async (b) => {
        const r = await bookings.get(b.key, { type: "json" });
        if (!r) return;
        const m = meta[b.key] || {};
        leads.push({ id: b.key, source: "site", stage: "agendado", notes: "", value: "", ...r, ...m });
        delete meta[b.key];
      })
    );
    // manual leads (and any orphaned meta that carries its own data)
    for (const [id, m] of Object.entries(meta)) {
      if (m && m.nome) leads.push({ id, source: "manual", stage: "novo", notes: "", value: "", ...m });
    }
    return json({ leads, stages: STAGES });
  }

  if (req.method === "POST") {
    let b;
    try {
      b = await req.json();
    } catch {
      return json({ error: "invalid" }, 400);
    }

    if (b.action === "update") {
      const id = clip(b.id, 40);
      if (!id) return json({ error: "invalid" }, 400);
      const cur = (await crm.get(id, { type: "json" })) || {};
      const next = { ...cur, updatedAt: new Date().toISOString() };
      if (b.stage !== undefined) {
        if (!STAGES.includes(b.stage)) return json({ error: "stage" }, 400);
        next.stage = b.stage;
      }
      if (b.notes !== undefined) next.notes = clip(b.notes, 4000);
      if (b.value !== undefined) next.value = clip(b.value, 20);
      // manual leads can edit their contact fields too
      for (const f of ["nome", "whatsapp", "email", "negocio", "setor", "desafio", "slot"]) {
        if (b[f] !== undefined && cur.nome) next[f] = clip(b[f], f === "desafio" ? 1000 : 160);
      }
      await crm.setJSON(id, next);
      return json({ ok: true });
    }

    // private link to the pre-diagnosis form (one random token per lead)
    if (b.action === "formlink") {
      const id = clip(b.id, 40);
      if (!id) return json({ error: "invalid" }, 400);
      const cur = (await crm.get(id, { type: "json" })) || {};
      let token = cur.formToken;
      if (!token) {
        token = randomBytes(15).toString("base64url");
        await getStore({ name: "forms", consistency: "strong" }).setJSON(token, { id });
        await crm.setJSON(id, { ...cur, formToken: token, formSentAt: new Date().toISOString() });
      }
      return json({ ok: true, token });
    }

    // diagnosis sheet filled in during the 30-minute analysis
    if (b.action === "diag") {
      const id = clip(b.id, 40);
      if (!id || typeof b.diag !== "object" || !b.diag) return json({ error: "invalid" }, 400);
      const d = b.diag;
      const num = (v, max) => Math.max(0, Math.min(max, Number(String(v ?? "").replace(",", ".")) || 0));
      const diag = {
        dor: clip(d.dor, 600),
        tarefa: clip(d.tarefa, 600),
        ferramentas: clip(d.ferramentas, 300),
        valorHora: num(d.valorHora, 10000),
        scores: Object.fromEntries(["at", "ag", "org", "aut", "pre"].map((k) => [k, Math.round(num(d.scores?.[k], 5))])),
        ops: (Array.isArray(d.ops) ? d.ops : []).slice(0, 3).map((o) => ({
          processo: clip(o?.processo, 160),
          frente: clip(o?.frente, 40),
          horas: num(o?.horas, 168),
          pct: num(o?.pct, 100),
        })),
        proximo: clip(d.proximo, 600),
        obs: clip(d.obs, 2000),
        updatedAt: new Date().toISOString(),
      };
      const cur = (await crm.get(id, { type: "json" })) || {};
      await crm.setJSON(id, { ...cur, diag, updatedAt: diag.updatedAt });
      return json({ ok: true });
    }

    if (b.action === "create") {
      const nome = clip(b.nome, 120);
      if (!nome) return json({ error: "invalid" }, 400);
      const id = "m-" + Date.now().toString(36);
      await crm.setJSON(id, {
        nome,
        whatsapp: clip(b.whatsapp, 40),
        email: clip(b.email, 160),
        negocio: clip(b.negocio, 160),
        setor: clip(b.setor, 80),
        desafio: clip(b.desafio, 1000),
        slot: clip(b.slot, 20),
        stage: STAGES.includes(b.stage) ? b.stage : "novo",
        notes: clip(b.notes, 4000),
        value: clip(b.value, 20),
        createdAt: new Date().toISOString(),
      });
      return json({ ok: true, id });
    }

    // Change the analysis time (Italy time, "YYYY-MM-DDTHH:MM").
    if (b.action === "reslot") {
      const id = clip(b.id, 60), slot = clip(b.slot, 16);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slot)) return json({ error: "slot" }, 400);
      const rec = await bookings.get(id, { type: "json" });
      if (rec) {
        const start = new Date(new Date(`${slot}:00Z`).getTime() - romeOffsetMin(slot) * 60000);
        // no "tomorrow" reminder when the new time is less than a day away
        const remindedAt = start - Date.now() < 26 * 3600000 ? "skipped" : null;
        await bookings.setJSON(id, { ...rec, slot, originalSlot: rec.originalSlot || rec.slot, remindedAt, rescheduledAt: new Date().toISOString() });
      } else {
        const m = await crm.get(id, { type: "json" });
        if (!m) return json({ error: "nf" }, 404);
        await crm.setJSON(id, { ...m, slot, updatedAt: new Date().toISOString() });
      }
      return json({ ok: true, slot });
    }

    // Transcript of the analysis call (pasted from Tactiq / Google Meet). The report is built by /api/crm-call.
    if (b.action === "transcript") {
      const id = clip(b.id, 60), text = String(b.text ?? "").trim().slice(0, 150000);
      if (!id || text.length < 200) return json({ error: "short" }, 400);
      const at = new Date().toISOString();
      await getStore({ name: "calls", consistency: "strong" }).setJSON(id, { text, at });
      const cur = (await crm.get(id, { type: "json" })) || {};
      await crm.setJSON(id, { ...cur, call: { status: "pending", at, chars: text.length } });
      return json({ ok: true });
    }
    if (b.action === "transcript-get") {
      const t = await getStore({ name: "calls", consistency: "strong" }).get(clip(b.id, 60), { type: "json" });
      return json({ ok: true, text: t?.text || "" });
    }

    // Follow-up after the analysis: e-mail with the presentation, the offer and the start date.
    if (b.action === "followup") {
      const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 60).map((x) => clip(x, 60));
      const kinds = b.kinds && typeof b.kinds === "object" ? b.kinds : {};
      const prazo = clip(b.prazo, 40);
      const getLead = async (id) => {
        const r = (await bookings.get(id, { type: "json" })) || {};
        const m = (await crm.get(id, { type: "json" })) || {};
        const l = { id, ...r, ...m };
        return l.nome ? l : null;
      };
      if (b.preview) {
        const l = (await getLead(ids[0])) || { id: "x", nome: "Maria" };
        return json({ ok: true, ...followupEmail(l, kinds[ids[0]] === "faltou" ? "faltou" : "veio", prazo) });
      }
      const results = {};
      for (const id of ids) {
        const l = await getLead(id);
        if (!l || !l.email) { results[id] = "no-email"; continue; }
        const kind = kinds[id] === "faltou" ? "faltou" : "veio";
        try {
          results[id] = await sendFollowup(l, kind, prazo);
          if (results[id] === "sent") {
            const m = (await crm.get(id, { type: "json" })) || {};
            await crm.setJSON(id, { ...m, followup: { kind, at: new Date().toISOString() } });
          }
        } catch (e) { results[id] = "error"; }
      }
      return json({ ok: true, results });
    }

    if (b.action === "delete") {
      const id = clip(b.id, 40);
      if (!id.startsWith("m-") && !id.startsWith("w-")) return json({ error: "only manual leads" }, 400);
      await crm.delete(id);
      return json({ ok: true });
    }

    return json({ error: "action" }, 400);
  }

  return json({ error: "method" }, 405);
};

export const config = { path: "/api/crm" };
