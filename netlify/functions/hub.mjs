import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { HOOK, OWNER, SITE, LIVE } from "../lib/notify.mjs";
import { CURRICULUM } from "../lib/curriculum.mjs";

// Operator Studio · Student Hub API
// Students log in with e-mail + password (invited by the mentor).
// The mentor (admin) uses the same key as the CRM.
//
// Store "hub":
//   students/<id>        student record
//   email/<email>        -> { id }
//   invite/<token>       -> { id }
//   auth/<token>         -> { id, exp }
//   materials/<week>     week material (1..8)
//   slots/<iso>          { start, dur, studentId?, week?, meet? }
//   groups/<iso>         group class { start, dur, title, studentIds[] } (up to 3 students + mentor)
//   forum/<id>           thread with replies
// Store "hubfiles": uploaded files

const WEEKS = 8;
const DUR = 90;
const CANCEL_MS = 24 * 3600000;
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const now = () => new Date().toISOString();
const rid = (n = 9) => randomBytes(n).toString("base64url");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const KEY_HASH = "2acd374aa638baece5951bc661972a3a3f941b082d49683f4064da31d304af8b";
function isAdmin(req) {
  const raw = String(req.headers.get("x-crm-key") || "").trim();
  if (!raw) return false;
  const env = process.env.CRM_KEY;
  // Once CRM_KEY is set in Netlify, only that password works (exact match).
  if (env) return raw === env.trim();
  const given = raw;
  return createHash("sha256").update(given).digest("hex") === KEY_HASH;
}

function hashPw(pw, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(pw, salt, 32).toString("hex") };
}
function checkPw(pw, rec) {
  if (!rec?.pwHash || !rec?.salt) return false;
  const a = Buffer.from(scryptSync(pw, rec.salt, 32).toString("hex"));
  const b = Buffer.from(rec.pwHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

const DEFAULT_WEEKS = [
  ["Fundamentos de IA e assistente do negócio", "Use a IA com senso crítico e saia com um assistente que já trabalha para o seu negócio."],
  ["Marca e Brand Kit", "Posicionamento, tom de voz e identidade visual: uma marca clara, usada em tudo o que vem depois."],
  ["Website", "Uma página profissional, com a marca nova, que capta clientes."],
  ["Conteúdo e Instagram", "Perfil reformulado, pilares de conteúdo e um mês planejado."],
  ["Vendas, CRM e captação", "Funil organizado e novos contatos entrando sozinhos, com aviso e follow-up."],
  ["Processos e sistema interno", "Um processo crítico redesenhado, com SOP e um sistema interno no-code."],
  ["Agentes de IA e integrações", "O assistente vira agente: atende clientes, ligado ao site, ao CRM e ao sistema interno."],
  ["ROI e roadmap", "Medir o que mudou, apresentar o que foi construído e planejar os próximos 90 dias."],
];

function publicStudent(s) {
  if (!s) return null;
  const { pwHash, salt, inviteToken, ...rest } = s;
  return { ...rest, active: !!pwHash };
}
const authorName = (s) => s.nome + (s.negocio ? " · " + s.negocio : "");

async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const out = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return out.filter(Boolean);
}

async function materials(store) {
  const out = [];
  for (let w = 1; w <= WEEKS; w++) {
    const m = await store.get(`materials/${w}`, { type: "json" });
    const c = CURRICULUM[w];
    const base = m || { week: w, title: c?.title || DEFAULT_WEEKS[w - 1][0], summary: c?.lead || DEFAULT_WEEKS[w - 1][1], body: "", items: [] };
    out.push({ ...base, content: !!c, pdf: c?.pdf || "", prompts: c?.prompts || 0, steps: c?.steps || 0 });
  }
  return out;
}

// Week 0 (tool setup) is always open for every student.
const setupWeek = () => { const c = CURRICULUM[0]; return c ? { week: 0, title: c.title, summary: c.lead, pdf: c.pdf, content: true, prompts: c.prompts, steps: c.steps, open: true } : null; };
const contentOf = (w) => { const c = CURRICULUM[w]; return c ? { week: c.week, title: c.title, lead: c.lead, meta: c.meta, pdf: c.pdf, sections: c.sections } : null; };

// A week opens when the mentor releases it, or automatically when the student's session for that week starts.
const SOON_MS = 15 * 60000;
function openWeeks(me, slots) {
  const set = new Set(me.released || []);
  const t = Date.now() + SOON_MS;
  for (const s of slots) if (s.studentId === me.id && s.week && new Date(s.start).getTime() <= t) set.add(s.week);
  return set;
}

function fmtWhen(iso) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return f.format(d) + " (horário de Milão)";
}

function emailHtml({ eyebrow, title, intro, whenText, cta, ctaUrl, closing }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F1EC;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Helvetica,Arial,sans-serif;color:#151412;">
<tr><td style="padding:0 4px 28px;font-family:Georgia,'Times New Roman',serif;font-size:22px;"><b>Operator</b> <i style="color:#7E7669;">Studio</i></td></tr>
<tr><td style="background:#FBFAF7;border:1px solid #D9D3C9;border-radius:20px;padding:36px 32px;">
<p style="margin:0 0 10px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#7E7669;">${eyebrow}</p>
<h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.15;font-weight:700;">${title}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#5F594F;">${intro}</p>
${whenText ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC;border-radius:14px;"><tr><td style="padding:20px 22px;"><p style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7E7669;">Data e horário</p><p style="margin:6px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:20px;">${whenText}</p><p style="margin:4px 0 0;font-size:14px;color:#5F594F;">${DUR} minutos · videochamada</p></td></tr></table>` : ""}
${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 10px;"><tr><td style="background:#151412;border-radius:999px;"><a href="${ctaUrl}" style="display:inline-block;padding:14px 26px;font-size:15px;color:#F3F1EC;text-decoration:none;">${cta}</a></td></tr></table>` : ""}
<p style="margin:18px 0 24px;font-size:16px;line-height:1.6;color:#5F594F;">${closing}</p>
<p style="margin:0;font-size:16px;line-height:1.6;"><b>Luccas Torres</b><br><span style="color:#7E7669;">Operator Studio</span></p>
</td></tr><tr><td style="padding:22px 4px 0;font-size:12px;color:#7E7669;"><a href="${SITE}/hub/" style="color:#7E7669;">Seu Student Hub</a> · @luccastorres</td></tr>
</table></td></tr></table></body></html>`;
}

// Session booked: Make creates the calendar event with Google Meet and e-mails the student (bcc mentor).
const quiet = (s) => !LIVE || !s.email || /@example\.(com|org)$/i.test(s.email);
async function notifyBooked(student, slot) {
  if (quiet(student)) return "";
  const start = new Date(slot.start), end = new Date(start.getTime() + DUR * 60000);
  const html = emailHtml({
    eyebrow: `Mentoria · Semana ${slot.week}`,
    title: `Sessão marcada, ${esc(student.nome.split(" ")[0])}.`,
    intro: `Sua sessão individual da semana ${slot.week} está confirmada. Os materiais ficam no seu Student Hub depois da aula.`,
    whenText: esc(fmtWhen(slot.start)),
    ...(process.env.DAILY_API_KEY
      ? { cta: "Entrar na aula", ctaUrl: `${SITE}/aula/?s=${encodeURIComponent(slot.start)}` }
      : { cta: "Entrar na videochamada", ctaUrl: "__MEET__" }),
    closing: "Precisa remarcar? Pelo Student Hub, até 24 horas antes.",
  });
  try {
    const res = await fetch(HOOK, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        type: "confirmation", id: "hub-" + slot.start, to: student.email, toName: student.nome, bcc: OWNER,
        subject: `Sessão confirmada · Semana ${slot.week} · ${fmtWhen(slot.start)}`, html, meet: "",
        event: { summary: `Mentoria · Semana ${slot.week} · ${student.nome}`, start: start.toISOString(), end: end.toISOString(),
          description: `Mentoria individual Operator Studio\nAluno: ${authorName(student)}\nE-mail: ${student.email}\n${process.env.DAILY_API_KEY ? `Sala da aula: ${SITE}/aula/?s=${encodeURIComponent(slot.start)}&m=1\n` : ""}Hub: ${SITE}/hub/admin/` },
      }),
    });
    const j = await res.json().catch(() => ({}));
    return j.meet || "";
  } catch { return ""; }
}

async function notifyGroup(student, g) {
  if (quiet(student)) return;
  const html = emailHtml({
    eyebrow: "Mentoria · Aula em grupo",
    title: `${esc(g.title)}.`,
    intro: `Oi, ${esc(student.nome.split(" ")[0])}! Você está na aula em grupo. A sala abre 15 minutos antes, pelo seu Student Hub.`,
    whenText: esc(fmtWhen(g.start)),
    cta: "Abrir o Student Hub", ctaUrl: `${SITE}/hub/#agenda`,
    closing: "Até lá!",
  });
  await fetch(HOOK, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
    body: JSON.stringify({ type: "reminder", id: "group-" + g.start + "-" + student.id, to: student.email, toName: student.nome, bcc: OWNER,
      subject: `Aula em grupo · ${g.title} · ${fmtWhen(g.start)}`, html, meet: "", event: null }),
  });
}

async function notifyCancelled(student, slot) {
  if (quiet(student)) return;
  const html = emailHtml({
    eyebrow: "Sessão desmarcada", title: "Horário liberado.",
    intro: `A sessão de ${esc(fmtWhen(slot.start))} foi desmarcada. Escolha um novo horário no seu Student Hub.`,
    cta: "Escolher novo horário", ctaUrl: `${SITE}/hub/#agenda`,
    closing: "Mentor: lembre de apagar o evento antigo da agenda.",
  });
  try {
    await fetch(HOOK, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ type: "reminder", id: "hub-cancel-" + slot.start, to: student.email, toName: student.nome, bcc: OWNER,
        subject: `Sessão desmarcada · ${fmtWhen(slot.start)}`, html, meet: "", event: null }),
    });
  } catch {}
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/hub\/?/, "").replace(/\/$/, "");
  const store = getStore({ name: "hub", consistency: "strong" });
  const files = getStore({ name: "hubfiles", consistency: "strong" });
  const method = req.method;
  let body = {};
  if (method === "POST" && !path.startsWith("admin/upload")) {
    try { body = await req.json(); } catch { body = {}; }
  }

  // ---------- public: login and invite ----------
  if (path === "login" && method === "POST") {
    const email = clip(body.email, 160).toLowerCase();
    const idx = email ? await store.get(`email/${email}`, { type: "json" }) : null;
    const s = idx ? await store.get(`students/${idx.id}`, { type: "json" }) : null;
    if (!s || !checkPw(String(body.password || ""), s)) return json({ error: "login" }, 401);
    const token = rid(24);
    await store.setJSON(`auth/${token}`, { id: s.id, exp: Date.now() + 30 * 86400000 });
    return json({ ok: true, token });
  }
  if (path === "invite" && method === "GET") {
    const t = clip(url.searchParams.get("t"), 60);
    const inv = t ? await store.get(`invite/${t}`, { type: "json" }) : null;
    const s = inv ? await store.get(`students/${inv.id}`, { type: "json" }) : null;
    if (!s) return json({ error: "invite" }, 404);
    return json({ ok: true, nome: s.nome.split(" ")[0], email: s.email });
  }
  if (path === "invite" && method === "POST") {
    const t = clip(body.t, 60), pw = String(body.password || "");
    if (pw.length < 8) return json({ error: "short" }, 400);
    const inv = t ? await store.get(`invite/${t}`, { type: "json" }) : null;
    const s = inv ? await store.get(`students/${inv.id}`, { type: "json" }) : null;
    if (!s) return json({ error: "invite" }, 404);
    const { salt, hash } = hashPw(pw);
    await store.setJSON(`students/${s.id}`, { ...s, salt, pwHash: hash, inviteToken: null, activatedAt: s.activatedAt || now() });
    await store.delete(`invite/${t}`);
    const token = rid(24);
    await store.setJSON(`auth/${token}`, { id: s.id, exp: Date.now() + 30 * 86400000 });
    return json({ ok: true, token });
  }

  // ---------- admin ----------
  if (path.startsWith("admin/")) {
    if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
    const a = path.slice(6);

    if (a === "state" && method === "GET") {
      const [students, slots, forum, mats, reps, groups] = await Promise.all([
        listJSON(store, "students/"), listJSON(store, "slots/"), listJSON(store, "forum/"), materials(store), listJSON(store, "reports/"), listJSON(store, "groups/"),
      ]);
      const reports = reps.map((r) => ({ start: r.start, status: r.status, shared: !!r.shared, studentId: r.studentId, studentName: r.studentName || "", week: r.week, group: !!r.group, title: r.title || "",
        minutes: r.minutes, questions: r.report?.perguntas?.length || 0, updatedAt: r.updatedAt }));
      return json({ students: students.map(publicStudent), slots, groups, forum, materials: mats, setup: setupWeek(), weeks: WEEKS, reports, live: !!process.env.DAILY_API_KEY });
    }
    if (a === "content" && method === "GET") {
      const c = contentOf(Number(url.searchParams.get("w")));
      return c ? json({ content: c }) : json({ error: "nf" }, 404);
    }
    if (a === "student" && method === "POST") {
      const id = clip(body.id, 40);
      if (id) {
        const s = await store.get(`students/${id}`, { type: "json" });
        if (!s) return json({ error: "nf" }, 404);
        const next = { ...s };
        for (const f of ["nome", "negocio", "perfil", "whatsapp", "notes"]) if (body[f] !== undefined) next[f] = clip(body[f], f === "notes" ? 2000 : 160);
        if (Array.isArray(body.released)) next.released = body.released.map(Number).filter((w) => w >= 1 && w <= WEEKS);
        if (body.extra && typeof body.extra === "object") {
          const ex = {};
          for (const [w, items] of Object.entries(body.extra)) {
            if (+w >= 1 && +w <= WEEKS && Array.isArray(items)) ex[w] = items.slice(0, 20).map((i) => ({ label: clip(i.label, 120), url: clip(i.url, 600) })).filter((i) => i.label && i.url);
          }
          next.extra = ex;
        }
        await store.setJSON(`students/${id}`, next);
        return json({ ok: true, student: publicStudent(next) });
      }
      const nome = clip(body.nome, 120), email = clip(body.email, 160).toLowerCase();
      if (!nome || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "invalid" }, 400);
      if (await store.get(`email/${email}`, { type: "json" })) return json({ error: "exists" }, 409);
      const sid = "s-" + Date.now().toString(36);
      const inviteToken = rid(18);
      const s = { id: sid, nome, email, negocio: clip(body.negocio, 160), perfil: clip(body.perfil, 20) || "Construir",
        whatsapp: clip(body.whatsapp, 40), released: [], extra: {}, notes: "", inviteToken, createdAt: now() };
      await store.setJSON(`students/${sid}`, s);
      await store.setJSON(`email/${email}`, { id: sid });
      await store.setJSON(`invite/${inviteToken}`, { id: sid });
      return json({ ok: true, student: publicStudent(s), invite: inviteToken });
    }
    if (a === "reinvite" && method === "POST") {
      const s = await store.get(`students/${clip(body.id, 40)}`, { type: "json" });
      if (!s) return json({ error: "nf" }, 404);
      if (s.inviteToken) await store.delete(`invite/${s.inviteToken}`);
      const inviteToken = rid(18);
      await store.setJSON(`students/${s.id}`, { ...s, inviteToken });
      await store.setJSON(`invite/${inviteToken}`, { id: s.id });
      return json({ ok: true, invite: inviteToken });
    }
    if (a === "student-delete" && method === "POST") {
      const s = await store.get(`students/${clip(body.id, 40)}`, { type: "json" });
      if (!s) return json({ error: "nf" }, 404);
      for (const sl of await listJSON(store, "slots/")) if (sl.studentId === s.id) await store.setJSON(`slots/${sl.start}`, { start: sl.start, dur: sl.dur });
      if (s.inviteToken) await store.delete(`invite/${s.inviteToken}`);
      await store.delete(`email/${s.email}`);
      await store.delete(`students/${s.id}`);
      return json({ ok: true });
    }
    if (a === "material" && method === "POST") {
      const w = Number(body.week);
      if (!(w >= 1 && w <= WEEKS)) return json({ error: "week" }, 400);
      const m = { week: w, title: clip(body.title, 120) || DEFAULT_WEEKS[w - 1][0], summary: clip(body.summary, 400), body: clip(body.body, 6000),
        items: (Array.isArray(body.items) ? body.items : []).slice(0, 30).map((i) => ({ label: clip(i.label, 120), url: clip(i.url, 600), kind: clip(i.kind, 20) })).filter((i) => i.label && i.url),
        updatedAt: now() };
      await store.setJSON(`materials/${w}`, m);
      return json({ ok: true, material: m });
    }
    if (a === "upload" && method === "POST") {
      const name = clip(decodeURIComponent(url.searchParams.get("name") || "arquivo"), 120);
      const type = clip(req.headers.get("content-type") || "application/octet-stream", 100);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 5.5 * 1024 * 1024) return json({ error: "size" }, 400);
      const fid = "f-" + Date.now().toString(36) + rid(4);
      await files.set(fid, buf, { metadata: { name, type } });
      return json({ ok: true, url: `/api/hub/file/${fid}`, name });
    }
    if (a === "slots" && method === "POST") {
      const add = Array.isArray(body.add) ? body.add.slice(0, 200) : [];
      const remove = Array.isArray(body.remove) ? body.remove.slice(0, 200) : [];
      let added = 0;
      for (const iso of add) {
        const d = new Date(iso);
        if (isNaN(d) || d < new Date()) continue;
        const k = d.toISOString();
        if (!(await store.get(`slots/${k}`, { type: "json" }))) { await store.setJSON(`slots/${k}`, { start: k, dur: DUR }); added++; }
      }
      for (const iso of remove) {
        const sl = await store.get(`slots/${iso}`, { type: "json" });
        if (sl && !sl.studentId) await store.delete(`slots/${iso}`);
      }
      return json({ ok: true, added });
    }
    // Test class: books a session for a student 5 minutes from now (no 2-hour rule, no e-mails).
    if (a === "test-class" && method === "POST") {
      const s = await store.get(`students/${clip(body.id, 40)}`, { type: "json" });
      if (!s) return json({ error: "nf" }, 404);
      const d = new Date(Date.now() + 5 * 60000); d.setSeconds(0, 0);
      const k = d.toISOString();
      const mine = (await listJSON(store, "slots/")).filter((x) => x.studentId === s.id);
      const used = new Set(mine.map((x) => x.week));
      let week = 1; for (let w = 1; w <= WEEKS; w++) if (!used.has(w)) { week = w; break; }
      await store.setJSON(`slots/${k}`, { start: k, dur: DUR, studentId: s.id, week, test: true, bookedAt: now() });
      return json({ ok: true, start: k, week });
    }
    // Group class: the mentor picks the time and up to 3 students.
    if (a === "group" && method === "POST") {
      const d = new Date(clip(body.start, 40));
      if (isNaN(d)) return json({ error: "date" }, 400);
      const ids = [...new Set((Array.isArray(body.studentIds) ? body.studentIds : []).map((x) => clip(x, 40)))].slice(0, 3);
      const members = (await Promise.all(ids.map((id) => store.get(`students/${id}`, { type: "json" })))).filter(Boolean);
      if (!members.length) return json({ error: "students" }, 400);
      const k = d.toISOString();
      if ((await store.get(`slots/${k}`, { type: "json" }))?.studentId) return json({ error: "taken" }, 409);
      const g = { start: k, dur: Math.max(15, Math.min(180, Number(body.dur) || DUR)), title: clip(body.title, 80) || "Aula em grupo", studentIds: members.map((m) => m.id), group: true, createdAt: now() };
      await store.setJSON(`groups/${k}`, g);
      if (body.notify !== false) for (const m of members) await notifyGroup(m, g).catch(() => {});
      return json({ ok: true, group: g });
    }
    if (a === "group-delete" && method === "POST") {
      const k = clip(body.start, 40);
      const g = await store.get(`groups/${k}`, { type: "json" });
      if (!g) return json({ error: "nf" }, 404);
      await store.delete(`groups/${k}`);
      return json({ ok: true });
    }
    if (a === "slot-cancel" && method === "POST") {
      const sl = await store.get(`slots/${clip(body.start, 40)}`, { type: "json" });
      if (!sl?.studentId) return json({ error: "nf" }, 404);
      const s = await store.get(`students/${sl.studentId}`, { type: "json" });
      await store.setJSON(`slots/${sl.start}`, { start: sl.start, dur: sl.dur });
      if (s && body.notify !== false) await notifyCancelled(s, sl);
      return json({ ok: true });
    }
    if (a === "post" && method === "POST") {
      return forumWrite(store, body, { id: "mentor", nome: "Luccas Torres", negocio: "Mentor" }, true);
    }
    if (a === "forum-delete" && method === "POST") {
      return forumDelete(store, body, null, true);
    }
    return json({ error: "route" }, 404);
  }

  // ---------- student (auth) ----------
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("t") || "";
  const auth = token ? await store.get(`auth/${clip(token, 60)}`, { type: "json" }) : null;
  const me = auth && auth.exp > Date.now() ? await store.get(`students/${auth.id}`, { type: "json" }) : null;

  if (path.startsWith("file/") && method === "GET") {
    if (!me && !isAdmin(req)) return new Response("Faça login no Student Hub para abrir este arquivo.", { status: 401 });
    const fid = clip(path.slice(5), 60);
    const got = await files.getWithMetadata(fid, { type: "arrayBuffer" });
    if (!got) return new Response("Arquivo não encontrado", { status: 404 });
    const { name = "arquivo", type = "application/octet-stream" } = got.metadata || {};
    return new Response(got.data, { headers: { "content-type": type, "content-disposition": `inline; filename="${encodeURIComponent(name)}"`, "cache-control": "private, max-age=3600" } });
  }

  if (!me) return json({ error: "auth" }, 401);

  if (path === "logout" && method === "POST") {
    await store.delete(`auth/${clip(token, 60)}`);
    return json({ ok: true });
  }

  if (path === "me" && method === "GET") {
    const [mats, slots] = await Promise.all([materials(store), listJSON(store, "slots/")]);
    const released = openWeeks(me, slots);
    const weeks = mats.map((m) => released.has(m.week)
      ? { ...m, open: true, extra: (me.extra || {})[m.week] || [] }
      : { week: m.week, title: m.title, summary: m.summary, open: false });
    const t = Date.now();
    const mine = slots.filter((s) => s.studentId === me.id).sort((a, b) => a.start.localeCompare(b.start));
    const free = slots.filter((s) => !s.studentId && new Date(s.start).getTime() > t + 2 * 3600000).sort((a, b) => a.start.localeCompare(b.start)).map((s) => ({ start: s.start, dur: s.dur }));
    const reps = await Promise.all(mine.map((s) => store.get(`reports/${s.start}`, { type: "json" })));
    const sessions = mine.map((s, i) => ({ ...s, report: !!(reps[i]?.shared && reps[i]?.status === "done" && reps[i]?.studentId === me.id) }));
    const gl = (await listJSON(store, "groups/")).filter((g) => (g.studentIds || []).includes(me.id)).sort((a, b) => a.start.localeCompare(b.start));
    const greps = await Promise.all(gl.map((g) => store.get(`reports/${g.start}`, { type: "json" })));
    const groups = gl.map((g, i) => ({ start: g.start, dur: g.dur, title: g.title, group: true, report: !!(greps[i]?.shared && greps[i]?.status === "done") }));
    return json({ me: publicStudent(me), weeks, setup: setupWeek(), sessions, groups, free, live: !!process.env.DAILY_API_KEY, rules: { cancelHours: 24, weeks: WEEKS } });
  }

  if (path === "content" && method === "GET") {
    const w = Number(url.searchParams.get("w"));
    if (w !== 0) {
      const open = openWeeks(me, await listJSON(store, "slots/"));
      if (!open.has(w)) return json({ error: "locked" }, 403);
    }
    const c = contentOf(w);
    return c ? json({ content: c }) : json({ error: "nf" }, 404);
  }

  if (path === "book" && method === "POST") {
    const k = clip(body.start, 40);
    const sl = await store.get(`slots/${k}`, { type: "json" });
    if (!sl || sl.studentId) return json({ error: "taken" }, 409);
    if (new Date(sl.start).getTime() < Date.now() + 2 * 3600000) return json({ error: "late" }, 400);
    const all = await listJSON(store, "slots/");
    const mine = all.filter((s) => s.studentId === me.id);
    // rescheduling: free the old slot first (only if allowed)
    let week = null;
    if (body.replace) {
      const old = mine.find((s) => s.start === body.replace);
      if (!old) return json({ error: "nf" }, 404);
      if (new Date(old.start).getTime() - Date.now() < CANCEL_MS) return json({ error: "too-late" }, 400);
      week = old.week;
    } else {
      const future = mine.filter((s) => new Date(s.start).getTime() > Date.now());
      if (future.length >= 2) return json({ error: "limit" }, 400);
      if (mine.length >= WEEKS) return json({ error: "done" }, 400);
      const used = new Set(mine.map((s) => s.week));
      for (let w = 1; w <= WEEKS; w++) if (!used.has(w)) { week = w; break; }
    }
    // claim, then verify (avoid double booking)
    const claim = { ...sl, studentId: me.id, week, bookedAt: now() };
    await store.setJSON(`slots/${k}`, claim);
    const check = await store.get(`slots/${k}`, { type: "json" });
    if (check.studentId !== me.id || check.bookedAt !== claim.bookedAt) return json({ error: "taken" }, 409);
    if (body.replace) {
      const old = mine.find((s) => s.start === body.replace);
      await store.setJSON(`slots/${old.start}`, { start: old.start, dur: old.dur });
    }
    const meet = await notifyBooked(me, claim);
    if (meet) await store.setJSON(`slots/${k}`, { ...claim, meet });
    return json({ ok: true, week, meet });
  }

  if (path === "cancel" && method === "POST") {
    const sl = await store.get(`slots/${clip(body.start, 40)}`, { type: "json" });
    if (!sl || sl.studentId !== me.id) return json({ error: "nf" }, 404);
    if (new Date(sl.start).getTime() - Date.now() < CANCEL_MS) return json({ error: "too-late" }, 400);
    await store.setJSON(`slots/${sl.start}`, { start: sl.start, dur: sl.dur });
    await notifyCancelled(me, sl);
    return json({ ok: true });
  }

  if (path === "forum" && method === "GET") {
    const threads = (await listJSON(store, "forum/")).sort((a, b) => (b.lastAt || b.createdAt).localeCompare(a.lastAt || a.createdAt));
    return json({ threads, meId: me.id });
  }
  if (path === "forum" && method === "POST") return forumWrite(store, body, me, false);
  if (path === "forum-delete" && method === "POST") return forumDelete(store, body, me, false);

  if (path === "password" && method === "POST") {
    if (!checkPw(String(body.current || ""), me)) return json({ error: "login" }, 401);
    const pw = String(body.password || "");
    if (pw.length < 8) return json({ error: "short" }, 400);
    const { salt, hash } = hashPw(pw);
    await store.setJSON(`students/${me.id}`, { ...me, salt, pwHash: hash });
    return json({ ok: true });
  }

  return json({ error: "route" }, 404);
};

async function forumWrite(store, body, author, isMentor) {
  const text = clip(body.body, 4000);
  if (!text) return json({ error: "empty" }, 400);
  const who = { authorId: author.id, author: authorName(author), mentor: !!isMentor };
  if (body.thread) {
    const t = await store.get(`forum/${clip(body.thread, 40)}`, { type: "json" });
    if (!t) return json({ error: "nf" }, 404);
    const reply = { id: "r-" + Date.now().toString(36) + rid(3), body: text, createdAt: now(), ...who };
    const next = { ...t, replies: [...(t.replies || []), reply].slice(-300), lastAt: reply.createdAt };
    await store.setJSON(`forum/${t.id}`, next);
    return json({ ok: true, thread: next });
  }
  const title = clip(body.title, 140);
  if (!title) return json({ error: "title" }, 400);
  const id = "t-" + Date.now().toString(36) + rid(3);
  const t = { id, title, body: text, topic: clip(body.topic, 40) || "Geral", createdAt: now(), lastAt: now(), replies: [], ...who };
  await store.setJSON(`forum/${id}`, t);
  return json({ ok: true, thread: t });
}

async function forumDelete(store, body, me, isMentor) {
  const t = await store.get(`forum/${clip(body.thread, 40)}`, { type: "json" });
  if (!t) return json({ error: "nf" }, 404);
  if (body.reply) {
    const r = (t.replies || []).find((x) => x.id === body.reply);
    if (!r) return json({ error: "nf" }, 404);
    if (!isMentor && r.authorId !== me.id) return json({ error: "forbidden" }, 403);
    await store.setJSON(`forum/${t.id}`, { ...t, replies: t.replies.filter((x) => x.id !== body.reply) });
    return json({ ok: true });
  }
  if (!isMentor && t.authorId !== me.id) return json({ error: "forbidden" }, 403);
  await store.delete(`forum/${t.id}`);
  return json({ ok: true });
}

export const config = { path: ["/api/hub", "/api/hub/*"] };
