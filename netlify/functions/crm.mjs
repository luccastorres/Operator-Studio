import { getStore } from "@netlify/blobs";
import { createHash, randomBytes } from "node:crypto";
import { followupEmail, sendFollowup } from "../lib/followup.mjs";
import { reportEmail, sendReport } from "../lib/reportmail.mjs";
import { welcomeEmail, sendWelcome, formUrlOf, inviteUrlOf } from "../lib/welcome.mjs";
import { callTool } from "../lib/report.mjs";
import { waReady, waTo, sendText, sendTemplate, needsTemplate, waProvider, waFrom, ycloudHook } from "../lib/whatsapp.mjs";

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
      // partner (duo mentoring) — any lead
      for (const f of ["socioNome", "socioEmail", "socioWhats"]) if (b[f] !== undefined) next[f] = clip(b[f], 160);
      if (b.hub && typeof b.hub === "object") next.hub = { ids: (b.hub.ids || []).slice(0, 2).map((x) => clip(x, 40)), invites: Object.fromEntries(Object.entries(b.hub.invites || {}).slice(0, 2).map(([k, v]) => [clip(k, 40), clip(v, 60)])), at: new Date().toISOString() };
      // payments (mentoria): total + installments with due dates
      if (b.pay && typeof b.pay === "object") {
        const num = (v) => Math.max(0, Math.round(Number(String(v ?? "").replace(",", ".")) * 100) / 100 || 0);
        next.pay = {
          total: num(b.pay.total), currency: "EUR", note: clip(b.pay.note, 300),
          items: (Array.isArray(b.pay.items) ? b.pay.items : []).slice(0, 24).map((x, i) => ({
            id: clip(x.id, 20) || `p${Date.now().toString(36)}${i}`, amount: num(x.amount),
            due: /^\d{4}-\d{2}-\d{2}$/.test(String(x.due || "")) ? x.due : "",
            paid: !!x.paid, paidAt: x.paid ? clip(x.paidAt, 30) || new Date().toISOString().slice(0, 10) : "",
            reminded: x.paid ? [] : (Array.isArray(x.reminded) ? x.reminded.slice(0, 5).map((r) => clip(r, 20)) : []),
          })).filter((x) => x.amount > 0),
        };
      }
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

    // Agenda of the free 30-minute analyses (Italy time). Read by /api/booking and the site.
    if (b.action && b.action.startsWith("agenda")) {
      const cs = getStore({ name: "booking-config", consistency: "strong" });
      const cfg = (await cs.get("cfg", { type: "json" })) || { slots: [] };
      const ok = (k) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(k);
      let slots = new Set(cfg.slots || []);
      if (b.action === "agenda-add") (Array.isArray(b.slots) ? b.slots : []).slice(0, 300).filter(ok).forEach((k) => slots.add(k));
      if (b.action === "agenda-remove") (Array.isArray(b.slots) ? b.slots : []).forEach((k) => slots.delete(k));
      if (b.action !== "agenda-get") {
        const keep = [...slots].filter((k) => romeOffsetMin(k) !== null && new Date(new Date(`${k}:00Z`).getTime() - romeOffsetMin(k) * 60000) > Date.now() - 86400000).sort();
        await cs.setJSON("cfg", { slots: keep, updatedAt: new Date().toISOString() });
        slots = new Set(keep);
      }
      const { blobs } = await bookings.list();
      const booked = {};
      await Promise.all(blobs.map(async (x) => { const r = await bookings.get(x.key, { type: "json" }); booked[x.key] = r?.nome || "Reservado"; }));
      return json({ ok: true, slots: [...slots].sort(), booked });
    }

    // Transcript of the analysis call (pasted from Tactiq / Google Meet). The report is built by /api/crm-call.
    if (b.action === "transcript") {
      const id = clip(b.id, 60), text = String(b.text ?? "").trim().slice(0, 150000);
      if (!id || text.length < 200) return json({ error: "short" }, 400);
      const at = new Date().toISOString(), kind = b.kind === "reuniao" ? "reuniao" : "venda";
      await getStore({ name: "calls", consistency: "strong" }).setJSON(id, { text, at, kind });
      const cur = (await crm.get(id, { type: "json" })) || {};
      await crm.setJSON(id, { ...cur, call: { status: "pending", kind, at, chars: text.length } });
      return json({ ok: true });
    }
    // Regenerate the report from the stored transcript, as a sales analysis or as a meeting report.
    if (b.action === "regen") {
      const id = clip(b.id, 60), kind = b.kind === "reuniao" ? "reuniao" : "venda";
      const cs = getStore({ name: "calls", consistency: "strong" });
      const t = await cs.get(id, { type: "json" });
      if (!t?.text) return json({ error: "notranscript" }, 404);
      await cs.setJSON(id, { ...t, kind });
      const cur = (await crm.get(id, { type: "json" })) || {};
      await crm.setJSON(id, { ...cur, call: { status: "pending", kind, at: t.at, chars: t.text.length } });
      return json({ ok: true });
    }
    if (b.action === "transcript-get") {
      const t = await getStore({ name: "calls", consistency: "strong" }).get(clip(b.id, 60), { type: "json" });
      return json({ ok: true, text: t?.text || "" });
    }

    // WhatsApp sent by the CRM (Meta Cloud API). Free text works within 24 h of the client's last message;
    // otherwise an approved template is needed (the test number has "hello_world").
    if (b.action === "wa-status") {
      // With YCloud, register the inbound webhook once so client replies show up in the CRM.
      let inbound = false, hookErr = "";
      if (waProvider() === "ycloud") {
        const wa = getStore({ name: "wa", consistency: "strong" });
        let cfg = (await wa.get("config", { type: "json" })) || {};
        if (!cfg.hookId || b.rehook) {
          try {
            const k = randomBytes(18).toString("base64url");
            const site = process.env.URL || "https://operator-studio.netlify.app";
            const h = await ycloudHook(`${site}/api/wa-in?k=${k}`);
            cfg = { hookKey: k, hookId: h.id, secret: h.secret, at: new Date().toISOString() };
            await wa.setJSON("config", cfg);
          } catch (e) { hookErr = String(e.message || e).slice(0, 200); }
        }
        inbound = !!cfg.hookId;
      }
      return json({ ok: true, ready: waReady(), provider: waProvider(), from: waFrom(), inbound, hookErr });
    }
    if (b.action === "wa-seen") {
      const id = clip(b.id, 60); const cur = (await crm.get(id, { type: "json" })) || null;
      if (cur?.waNew) { delete cur.waNew; await crm.setJSON(id, cur); }
      return json({ ok: true });
    }
    if (b.action === "wa-send") {
      if (!waReady()) return json({ error: "setup" }, 503);
      const id = clip(b.id, 60), text = String(b.text ?? "").trim().slice(0, 4000);
      const lead = id ? { ...((await bookings.get(id, { type: "json" })) || {}), ...((await crm.get(id, { type: "json" })) || {}) } : {};
      const to = waTo(b.to || lead.whatsapp);
      if (!to || to.length < 8) return json({ error: "number" }, 400);
      try {
        const r = b.template ? await sendTemplate(to, clip(b.template, 60), clip(b.lang, 10) || "pt_BR", Array.isArray(b.params) ? b.params.slice(0, 10) : [])
          : await sendText(to, text);
        if (id) {
          const cur = (await crm.get(id, { type: "json" })) || {};
          const log = [{ at: new Date().toISOString(), dir: "out", to, text: b.template ? `[modelo ${b.template}]` : text.slice(0, 300), mid: r.id }, ...(cur.waLog || [])].slice(0, 60);
          await crm.setJSON(id, { ...cur, waLog: log });
        }
        return json({ ok: true, id: r.id });
      } catch (e) {
        return json({ error: needsTemplate(e) ? "window" : "meta", detail: String(e.message || e).slice(0, 300), code: e.code || null }, 400);
      }
    }

    // Welcome e-mail for a new mentee (and partner): Student Hub invite + onboarding form link.
    if (b.action === "welcome") {
      const id = clip(b.id, 60);
      const lead = { id, ...((await bookings.get(id, { type: "json" })) || {}), ...((await crm.get(id, { type: "json" })) || {}) };
      const ob = getStore({ name: "onboard", consistency: "strong" });
      const people = [{ who: "a", nome: lead.nome, email: lead.email }, ...(lead.socioNome ? [{ who: "b", nome: lead.socioNome, email: lead.socioEmail }] : [])];
      const w = lead.welcome || { tokens: {} };
      const tokens = { ...(w.tokens || {}) };
      for (const p of people) if (!tokens[p.who]) { tokens[p.who] = randomBytes(15).toString("base64url"); await ob.setJSON(tokens[p.who], { id, who: p.who, nome: p.nome }); }
      const inv = lead.hub?.invites || {}, ids = lead.hub?.ids || [];
      const start = clip(b.start, 80), note = clip(b.note, 600);
      const mailFor = (p, i) => welcomeEmail({ person: p, partner: people[1 - i] && people.length > 1 ? people[1 - i] : null, inviteUrl: inviteUrlOf(inv[ids[i]]), formUrl: formUrlOf(tokens[p.who]), start, note });
      const save = async (extra) => { const cur = (await crm.get(id, { type: "json" })) || {}; await crm.setJSON(id, { ...cur, welcome: { ...(cur.welcome || {}), tokens, start, ...extra } }); };
      if (b.preview) { await save({}); return json({ ok: true, ...mailFor(people[0], 0), links: people.map((p) => ({ nome: p.nome, url: formUrlOf(tokens[p.who]) })) }); }
      const results = {};
      for (const [i, p] of people.entries()) {
        try { results[p.nome] = p.email ? await sendWelcome(p.email, p.nome, mailFor(p, i), `welcome-${id}-${p.who}`) : "no-email"; } catch { results[p.nome] = "error"; }
      }
      await save({ sentAt: new Date().toISOString(), results });
      return json({ ok: true, results });
    }

    // Plan for the first class, from the onboarding answers (and anything else known about the lead).
    if (b.action === "plan1") {
      const id = clip(b.id, 60);
      const lead = { id, ...((await bookings.get(id, { type: "json" })) || {}), ...((await crm.get(id, { type: "json" })) || {}) };
      const answers = Object.values(lead.onboarding || {});
      if (!answers.length && !lead.form) return json({ error: "noanswers" }, 400);
      const TOOL = { name: "plano_primeira_aula", description: "Roteiro da primeira aula da mentoria.", input_schema: { type: "object", properties: {
        retrato: { type: "string", description: "3 a 4 frases: quem são, o negócio, nível com IA e ferramentas." },
        dores: { type: "array", items: { type: "string" }, description: "As dores e onde vai o tempo, em ordem de prioridade, com as palavras delas quando possível." },
        horas: { type: "string", description: "Estimativa de horas por semana em tarefas repetitivas, se der para saber." },
        objetivo_aula: { type: "string", description: "O que elas saem da 1ª aula tendo construído (uma coisa concreta)." },
        roteiro: { type: "array", description: "Blocos da aula de 90 min.", items: { type: "object", properties: { min: { type: "string" }, bloco: { type: "string" }, detalhe: { type: "string" } }, required: ["min", "bloco"] } },
        preparar: { type: "array", items: { type: "string" }, description: "O que o Luccas deve preparar antes (prompts, templates, contas, exemplos)." },
        pedir: { type: "array", items: { type: "string" }, description: "O que pedir para elas trazerem ou deixarem pronto." },
        oito_semanas: { type: "array", items: { type: "string" }, description: "Sugestão de foco por semana (1 a 8), ligada às dores." },
        cuidado: { type: "array", items: { type: "string" }, description: "Pontos de atenção (nível técnico, expectativas, dinâmica da dupla)." },
      }, required: ["retrato", "dores", "objetivo_aula", "roteiro", "preparar", "pedir", "oito_semanas"] } };
      const ctx = JSON.stringify({ cliente: lead.nome, socio: lead.socioNome || null, negocio: lead.negocio, setor: lead.setor, desafio_na_reserva: lead.desafio,
        pre_diagnostico: lead.form || null, ficha_analise: lead.diag || null, relatorio_call: lead.call?.report || null, onboarding: lead.onboarding || null, notas: lead.notes || "" });
      try {
        const out = await callTool(TOOL, `Você é o assistente do Luccas Torres, mentor da Operator Studio (mentoria individual ou em dupla de 8 semanas: IA no dia a dia, automações, sistemas como CRM e agenda, site e conteúdo). Com base nos dados abaixo (principalmente as respostas do onboarding), monte o plano da PRIMEIRA aula (90 minutos), focado nas dores e no que mais consome tempo. Português do Brasil, direto e prático, sem inventar nada que não esteja nos dados. Responda chamando a ferramenta plano_primeira_aula.

<dados>
${ctx}
</dados>`, 3500);
        const cur = (await crm.get(id, { type: "json" })) || {};
        const plan1 = { ...out.report, at: new Date().toISOString() };
        await crm.setJSON(id, { ...cur, plan1 });
        return json({ ok: true, plan1 });
      } catch (e) { return json({ error: "claude", detail: String(e.message || e).slice(0, 200) }, 502); }
    }

    // Send the meeting report to the client by e-mail (preview: true returns the e-mail without sending).
    if (b.action === "sendreport") {
      const id = clip(b.id, 60);
      const lead = { id, ...((await bookings.get(id, { type: "json" })) || {}), ...((await crm.get(id, { type: "json" })) || {}) };
      if (!lead.call || lead.call.status !== "done") return json({ error: "noreport" }, 400);
      if (b.email) lead.email = clip(b.email, 160);
      const note = clip(b.note, 600);
      if (b.preview) return json({ ok: true, ...reportEmail(lead, lead.call, note) });
      if (!lead.email) return json({ error: "noemail" }, 400);
      const r = await sendReport(lead, lead.call, note);
      if (r === "sent") {
        const cur = (await crm.get(id, { type: "json" })) || {};
        await crm.setJSON(id, { ...cur, ...(b.email && !cur.email ? { email: lead.email } : {}), call: { ...cur.call, sentAt: new Date().toISOString(), sentTo: lead.email } });
      }
      return json({ ok: true, result: r });
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
