import { getStore } from "@netlify/blobs";

// Send history per lead: every e-mail and WhatsApp the CRM sends to a client, with the content as sent.
// Kept in its own store ("sentlog", keyed by lead id) so the lead list stays light; the CRM loads it when a lead is opened.

const store = () => getStore({ name: "sentlog", consistency: "strong" });
const MAX = 80;

export const LABELS = {
  confirmation: "Confirmação da análise",
  reminder: "Lembrete 24h da análise",
  veio: "Follow-up pós-análise",
  faltou: "Follow-up (não compareceu)",
  lembrete: "Lembrete de decisão",
  report: "Relatório da reunião",
  welcome: "Boas-vindas · Student Hub",
  whatsapp: "WhatsApp",
};

// Never throws: a failed log must not turn a successful send into an error.
export async function logSent(leadId, entry) {
  if (!leadId) return;
  try {
    const s = store();
    const cur = (await s.get(leadId, { type: "json" })) || { items: [] };
    const item = { at: new Date().toISOString(), label: LABELS[entry.kind] || entry.kind, ...entry };
    await s.setJSON(leadId, { items: [item, ...(cur.items || [])].slice(0, MAX) });
  } catch (e) {
    console.log("sentlog", leadId, e.message);
  }
}

// Logged sends, plus earlier sends known only from the lead's own fields (before this log existed), without content.
export async function sentHistory(leadId, lead = {}) {
  const items = ((await store().get(leadId, { type: "json" })) || {}).items || [];
  const has = (kind) => items.some((x) => x.kind === kind);
  const older = [];
  const add = (kind, at, to, extra = {}) => at && !has(kind) && older.push({ at, kind, label: LABELS[kind], to: to || "", channel: "email", legacy: true, ...extra });
  add("confirmation", lead.confirmedAt, lead.email);
  if (lead.remindedAt && lead.remindedAt !== "skipped") add("reminder", lead.remindedAt, lead.email);
  if (lead.followup) add(lead.followup.kind === "faltou" ? "faltou" : "veio", lead.followup.at, lead.email);
  if (lead.lembrete) add("lembrete", lead.lembrete.at, lead.email);
  if (lead.call?.sentAt) add("report", lead.call.sentAt, lead.call.sentTo || lead.email);
  if (lead.welcome?.sentAt) add("welcome", lead.welcome.sentAt, lead.email);
  if (!has("whatsapp")) for (const w of lead.waLog || []) if (w.dir === "out") older.push({ at: w.at, kind: "whatsapp", label: LABELS.whatsapp, channel: "whatsapp", to: w.to, text: w.text, legacy: true });
  return [...items, ...older].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
