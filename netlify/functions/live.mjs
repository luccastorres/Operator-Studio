import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { isAdmin, studentFrom } from "../lib/hubauth.mjs";
import { buildReport, mergedLines, transcriptText } from "../lib/report.mjs";

// Operator Studio · live classroom API (/api/live/*)
//   POST join    { start }                 -> Daily room url + meeting token
//   POST lines   { start, lines[] }        -> stores transcript lines (also accepts sendBeacon with k/t in body)
//   POST end     { start }   (mentor)      -> marks the report as pending (the page then calls /api/live-report)
//   GET  report  ?s=start                  -> mentor: full report + transcript · student: shared version
//   POST share   { start, shared } (mentor)

const DUR = 90;
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const DAILY = "https://api.daily.co/v1";

async function daily(path, method = "GET", body) {
  const res = await fetch(DAILY + path, {
    method, signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${process.env.DAILY_API_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, j };
}

function roomName(start, studentId) {
  const compact = start.replace(/[^0-9T]/g, "").slice(0, 13);
  const h = createHash("sha256").update(String(studentId)).digest("hex").slice(0, 6);
  return `aula-${compact}-${h}`;
}

const STUDENT_FIELDS = ["resumo", "perguntas", "construido", "tarefas", "proximo_passo"];

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/live\/?/, "").replace(/\/$/, "");
  const store = getStore({ name: "hub", consistency: "strong" });
  let body = {};
  if (req.method === "POST") { try { body = JSON.parse(await req.text()); } catch { body = {}; } }

  const admin = isAdmin(req, body);
  const me = admin ? null : await studentFrom(req, store, body);
  if (!admin && !me) return json({ error: "auth" }, 401);

  const start = clip(body.start || url.searchParams.get("s"), 40);
  const slot = start ? await store.get(`slots/${start}`, { type: "json" }) : null;
  const report = start ? await store.get(`reports/${start}`, { type: "json" }) : null;
  // A student may only touch their own session. The mentor may open past sessions that still have a report.
  const owns = admin || (slot?.studentId && slot.studentId === me.id) || (report?.studentId && report.studentId === me?.id);
  if (!start || !owns) return json({ error: "nf" }, 404);

  if (path === "join" && req.method === "POST") {
    if (!slot?.studentId) return json({ error: "nf" }, 404);
    const t0 = new Date(slot.start).getTime(), now = Date.now();
    const opensAt = t0 - (admin ? 60 : 15) * 60000, closesAt = t0 + (DUR + (admin ? 180 : 60)) * 60000;
    if (now < opensAt) return json({ error: "early", opensAt: new Date(opensAt).toISOString() }, 400);
    if (now > closesAt) return json({ error: "over" }, 400);
    if (!process.env.DAILY_API_KEY) return json({ error: "setup", meet: slot.meet || "" }, 503);

    const student = await store.get(`students/${slot.studentId}`, { type: "json" });
    const exp = Math.floor((t0 + (DUR + 180) * 60000) / 1000);
    const name = roomName(slot.start, slot.studentId);
    let room = await daily("/rooms", "POST", { name, privacy: "private", properties: { exp, eject_at_room_exp: true, max_participants: 4, enable_chat: false, enable_prejoin_ui: false } });
    if (!room.ok) room = await daily(`/rooms/${name}`);
    if (!room.ok || !room.j.url) return json({ error: "daily", detail: room.j?.info || room.j?.error || room.status }, 502);

    const user = admin ? { user_name: "Luccas Torres", user_id: "mentor", is_owner: true } : { user_name: me.nome, user_id: me.id, is_owner: false };
    const tok = await daily("/meeting-tokens", "POST", { properties: { room_name: name, exp, ...user } });
    if (!tok.ok || !tok.j.token) return json({ error: "daily", detail: tok.j?.info || tok.status }, 502);

    const mat = slot.week ? await store.get(`materials/${slot.week}`, { type: "json" }) : null;
    // Mentor: PDFs from every week, to present inside the room.
    const decks = [];
    if (admin) for (let w = 1; w <= 8; w++) {
      const m = await store.get(`materials/${w}`, { type: "json" });
      for (const i of m?.items || []) if (/^\/api\/hub\/file\//.test(i.url) || /\.pdf($|\?)/i.test(i.url)) decks.push({ label: i.label, url: i.url, week: w });
    }
    return json({
      ok: true, url: room.j.url, token: tok.j.token, role: admin ? "mentor" : "student",
      start: slot.start, dur: slot.dur || DUR, week: slot.week,
      student: { id: student?.id, nome: student?.nome || "", negocio: student?.negocio || "" },
      material: mat ? { title: mat.title, items: (mat.items || []).slice(0, 30) } : null,
      decks,
      stt: { language: process.env.STT_LANG || "pt-BR", model: process.env.STT_MODEL || "nova-2" },
    });
  }

  if (path === "lines" && req.method === "POST") {
    const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 500).map((l) => ({
      ts: Number(l.ts) || 0, pid: clip(l.pid, 60), uid: clip(l.uid, 60), name: clip(l.name, 80),
      role: l.uid === "mentor" ? "mentor" : "student", text: clip(l.text, 2000),
    })).filter((l) => l.ts && l.text);
    if (!lines.length) return json({ ok: true, saved: 0 });
    const who = admin ? "m" : "s";
    await store.setJSON(`live/${start}/${who}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, { lines });
    return json({ ok: true, saved: lines.length });
  }

  if (path === "end" && req.method === "POST") {
    if (!admin) return json({ error: "forbidden" }, 403);
    await store.setJSON(`reports/${start}`, {
      ...(report || {}), start, status: "pending", shared: !!report?.shared,
      studentId: slot?.studentId || report?.studentId, week: slot?.week || report?.week, updatedAt: new Date().toISOString(),
    });
    return json({ ok: true });
  }

  // Fallback when the background job is unavailable: build the report in this request (up to 60 s).
  if (path === "generate" && req.method === "POST") {
    if (!admin) return json({ error: "forbidden" }, 403);
    const status = await buildReport(store, start);
    return json({ ok: status === "done", status, report: await store.get(`reports/${start}`, { type: "json" }) });
  }

  if (path === "share" && req.method === "POST") {
    if (!admin) return json({ error: "forbidden" }, 403);
    if (!report) return json({ error: "nf" }, 404);
    await store.setJSON(`reports/${start}`, { ...report, shared: !!body.shared });
    return json({ ok: true, shared: !!body.shared });
  }

  if (path === "report" && req.method === "GET") {
    if (admin) {
      let tr = await store.get(`transcripts/${start}`, { type: "json" });
      if (!tr) {
        // No report yet: show whatever transcript has arrived so far.
        const student = slot?.studentId ? await store.get(`students/${slot.studentId}`, { type: "json" }) : null;
        const lines = await mergedLines(store, start);
        const { paras, minutes } = transcriptText(lines, student);
        tr = { paras, minutes, count: lines.length, live: true };
      }
      const studentId = report?.studentId || slot?.studentId;
      const student = studentId ? await store.get(`students/${studentId}`, { type: "json" }) : null;
      return json({ report: report || null, transcript: tr, slot, student: student ? { nome: student.nome, negocio: student.negocio, email: student.email } : null });
    }
    if (!report?.shared || report.status !== "done") return json({ error: "nf" }, 404);
    const r = {};
    for (const f of STUDENT_FIELDS) r[f] = report.report?.[f];
    return json({ report: { start, week: report.week, minutes: report.minutes, report: r, updatedAt: report.updatedAt } });
  }

  return json({ error: "route" }, 404);
};

export const config = { path: ["/api/live/*"] };
