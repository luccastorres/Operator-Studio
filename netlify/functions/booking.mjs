import { getStore } from "@netlify/blobs";
import { processBooking, romeToUtc } from "../lib/notify.mjs";

// Open analysis times (Italy time, "YYYY-MM-DDTHH:MM") are set in the CRM (Agenda) and kept in store "booking-config", key "cfg".
// The agenda is "full" (waitlist form) when no future open time is left.
const clip = (v, n) => String(v ?? "").trim().slice(0, n);

export default async (req, context) => {
  const store = getStore({ name: "bookings", consistency: "strong" });

  const cfg = (await getStore({ name: "booking-config", consistency: "strong" }).get("cfg", { type: "json" })) || { slots: [] };
  const future = (cfg.slots || []).filter((k) => romeToUtc(k) > new Date()).sort();

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const booked = new Set(blobs.map((b) => b.key));
    return Response.json(
      { slots: future, booked: [...booked], full: !future.some((k) => !booked.has(k)) },
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
    if (body.waitlist === true) {
      const nome = clip(body.nome, 120), whatsapp = clip(body.whatsapp, 40);
      if (!nome || !whatsapp) return Response.json({ error: "invalid" }, { status: 400 });
      const crm = getStore({ name: "crm", consistency: "strong" });
      const id = "w-" + Date.now().toString(36);
      await crm.setJSON(id, {
        nome, whatsapp,
        email: clip(body.email, 160), negocio: clip(body.negocio, 160),
        setor: clip(body.setor, 80), desafio: clip(body.desafio, 1000),
        source: "waitlist", stage: "novo", notes: "Lista de espera", value: "",
        createdAt: new Date().toISOString(),
      });
      return Response.json({ ok: true, waitlist: true });
    }
    const slot = clip(body.slot, 20);
    const nome = clip(body.nome, 120);
    const whatsapp = clip(body.whatsapp, 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slot) || !nome || !whatsapp) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }
    if (!future.includes(slot)) return Response.json({ error: "past" }, { status: 400 });
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
