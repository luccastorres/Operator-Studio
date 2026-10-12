import { getStore } from "@netlify/blobs";
import { processBooking } from "../lib/notify.mjs";

const DAYS = ["2026-10-16", "2026-10-17", "2026-10-18"];
const TIMES = ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"];
const VALID = new Set(DAYS.flatMap((d) => TIMES.map((t) => `${d}T${t}`)));
const CAP = 10; // total analyses offered; booking closes when reached
const clip = (v, n) => String(v ?? "").trim().slice(0, n);

export default async (req, context) => {
  const store = getStore({ name: "bookings", consistency: "strong" });

  if (req.method === "GET") {
    const { blobs } = await store.list();
    return Response.json(
      { booked: blobs.map((b) => b.key), full: blobs.length >= CAP },
      { headers: { "cache-control": "no-store" } }
    );
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid" }, { status: 400 });
    }
    const slot = clip(body.slot, 20);
    const nome = clip(body.nome, 120);
    const whatsapp = clip(body.whatsapp, 40);
    if (!VALID.has(slot) || !nome || !whatsapp) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }
    // Milan is UTC+2 on these dates (summer time until 25 Oct 2026)
    if (new Date(`${slot}:00+02:00`) < new Date()) {
      return Response.json({ error: "past" }, { status: 400 });
    }
    const record = {
      slot,
      nome,
      whatsapp,
      email: clip(body.email, 160),
      negocio: clip(body.negocio, 160),
      setor: clip(body.setor, 80),
      desafio: clip(body.desafio, 1000),
      createdAt: new Date().toISOString(),
    };
    const { blobs: existing } = await store.list();
    if (existing.length >= CAP) return Response.json({ error: "full" }, { status: 409 });
    const { modified } = await store.setJSON(slot, record, { onlyIfNew: true });
    if (!modified) return Response.json({ error: "taken" }, { status: 409 });
    // confirmation email + Google Meet, sent in the background
    const job = processBooking(store, slot).catch(() => {});
    if (context && typeof context.waitUntil === "function") context.waitUntil(job);
    else await job;
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/booking" };
