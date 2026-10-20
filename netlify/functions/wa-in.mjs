import { getStore } from "@netlify/blobs";
import { samePhone } from "../lib/whatsapp.mjs";

// YCloud webhook: WhatsApp messages clients send to Luccas's number (and the ones he sends from the app)
// are logged on the matching CRM lead (waLog). Unknown numbers go to store "wa" under inbox/.
// URL registered by the CRM (action wa-status): /api/wa-in?k=<hookKey>

const json = (d, s = 200) => Response.json(d, { status: s });

function textOf(m) {
  if (!m) return "";
  if (m.text?.body) return m.text.body;
  if (m.button?.text) return m.button.text;
  if (m.interactive) return m.interactive.button_reply?.title || m.interactive.list_reply?.title || "[resposta]";
  if (m.reaction) return `[reação ${m.reaction.emoji || ""}]`;
  const media = { image: "foto", video: "vídeo", audio: "áudio", voice: "áudio", document: "documento", sticker: "figurinha", location: "localização", contacts: "contato" }[m.type];
  const cap = m[m.type]?.caption;
  return media ? `[${media}]${cap ? " " + cap : ""}` : `[${m.type || "mensagem"}]`;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  const wa = getStore({ name: "wa", consistency: "strong" });
  const cfg = (await wa.get("config", { type: "json" })) || {};
  const k = new URL(req.url).searchParams.get("k") || "";
  if (!cfg.hookKey || k !== cfg.hookKey) return json({ error: "forbidden" }, 403);

  const ev = await req.json().catch(() => null);
  if (!ev) return json({ ok: true });

  let entry = null, phone = "";
  if (ev.type === "whatsapp.inbound_message.received") {
    const m = ev.whatsappInboundMessage || {};
    phone = m.from;
    entry = { at: m.sendTime || ev.createTime || new Date().toISOString(), dir: "in", from: phone, name: m.customerProfile?.name || "", text: textOf(m).slice(0, 1000), mid: m.wamid || m.id || "" };
  } else if (ev.type === "whatsapp.smb.message.echoes") {
    const m = ev.whatsappMessage || {};
    phone = m.to;
    entry = { at: m.sendTime || m.createTime || ev.createTime || new Date().toISOString(), dir: "app", to: phone, text: textOf(m).slice(0, 1000), mid: m.wamid || m.id || "" };
  } else return json({ ok: true, ignored: ev.type || "" });

  if (!phone || (entry.dir === "in" && !entry.text)) return json({ ok: true });

  // Find the lead with this number (client or partner).
  const crm = getStore({ name: "crm", consistency: "strong" });
  const bookings = getStore({ name: "bookings", consistency: "strong" });
  const [{ blobs: bk }, { blobs: cm }] = await Promise.all([bookings.list(), crm.list()]);
  let id = null;
  for (const b of cm) {
    const r = await crm.get(b.key, { type: "json" });
    if (r && (samePhone(r.whatsapp, phone) || samePhone(r.socioWhats, phone))) { id = b.key; break; }
  }
  if (!id) for (const b of bk) {
    const r = await bookings.get(b.key, { type: "json" });
    if (r && samePhone(r.whatsapp, phone)) { id = b.key; break; }
  }

  if (!id) {
    await wa.setJSON(`inbox/${Date.now()}-${String(phone).replace(/\D/g, "").slice(-6)}`, entry);
    return json({ ok: true, matched: false });
  }
  const cur = (await crm.get(id, { type: "json" })) || {};
  const log = cur.waLog || [];
  if (entry.mid && log.some((x) => x.mid === entry.mid)) return json({ ok: true, dup: true });
  const next = { ...cur, waLog: [entry, ...log].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60) };
  if (entry.dir === "in") next.waNew = entry.at;
  await crm.setJSON(id, next);
  return json({ ok: true, matched: true });
};

export const config = { path: "/api/wa-in" };
