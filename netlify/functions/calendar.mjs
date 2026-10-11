import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// Private iCalendar feed of booked analyses, for subscribing in Apple/Google/Outlook Calendar.
// URL: /api/calendar.ics?k=<token>   (only the token's SHA-256 is stored here)
const TOKEN_HASH = "7a38aeb9e5d1dae8429d00e1e3c92ddf5636c0fd3523b52d386b42ecd3810896";
const sha = (v) => createHash("sha256").update(v).digest("hex");

// Convert a Europe/Rome wall-clock "YYYY-MM-DDTHH:MM" to a UTC Date.
function romeToUtc(slot) {
  const guess = new Date(slot + ":00Z");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(guess);
  const g = (t) => parts.find((p) => p.type === t).value;
  const asRome = new Date(`${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:00Z`);
  return new Date(guess.getTime() - (asRome.getTime() - guess.getTime()));
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
const fold = (line) => {
  const out = [];
  let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
  out.push(s);
  return out.join("\r\n");
};

export default async (req) => {
  const k = new URL(req.url).searchParams.get("k") || "";
  if (!k || sha(k) !== TOKEN_HASH) return new Response("Not found", { status: 404 });

  const bookings = getStore({ name: "bookings", consistency: "strong" });
  const crm = getStore({ name: "crm", consistency: "strong" });
  const [{ blobs: bk }, { blobs: cm }] = await Promise.all([bookings.list(), crm.list()]);
  const meta = {};
  await Promise.all(cm.map(async (b) => (meta[b.key] = await crm.get(b.key, { type: "json" }))));

  const leads = [];
  await Promise.all(bk.map(async (b) => {
    const r = await bookings.get(b.key, { type: "json" });
    if (r) leads.push({ id: b.key, ...r, ...(meta[b.key] || {}) });
    delete meta[b.key];
  }));
  for (const [id, m] of Object.entries(meta)) if (m && m.nome && m.slot) leads.push({ id, ...m });

  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Operator Studio//CRM//PT",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Operator Studio · Análises", "X-WR-TIMEZONE:Europe/Rome",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
  ];
  for (const l of leads) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(l.slot || "")) continue;
    const start = romeToUtc(l.slot);
    const end = new Date(start.getTime() + 30 * 60000);
    const lost = l.stage === "perdido";
    const desc = [
      l.negocio && `Negócio: ${l.negocio}`, l.setor && `Setor: ${l.setor}`,
      l.whatsapp && `WhatsApp: ${l.whatsapp}`, l.email && `E-mail: ${l.email}`,
      l.desafio && `Desafio: ${l.desafio}`, l.notes && `Notas: ${l.notes}`,
      "", "CRM: https://operator-studio.netlify.app/crm/",
    ].filter((x) => x !== undefined && x !== false && x !== null).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${l.id.replace(/[^\w-]/g, "")}@operator-studio`,
      `DTSTAMP:${now}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`Análise · ${l.nome}${l.negocio ? " (" + l.negocio + ")" : ""}`)}`,
      `DESCRIPTION:${esc(desc)}`,
      "URL:https://operator-studio.netlify.app/crm/",
      `STATUS:${lost ? "CANCELLED" : "CONFIRMED"}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Análise em 15 minutos", "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": 'inline; filename="operator-studio.ics"',
    },
  });
};

export const config = { path: "/api/calendar.ics" };
