// WhatsApp sending for the CRM.
// Preferred: YCloud (Coexistence: same number as the WhatsApp Business app). Env: YCLOUD_API_KEY, YCLOUD_FROM (+971…).
// Fallback: Meta Cloud API directly. Env: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID.
const META = "https://graph.facebook.com/v21.0";
export const YC = "https://api.ycloud.com/v2";

const yc = () => !!(process.env.YCLOUD_API_KEY && process.env.YCLOUD_FROM);
export const waProvider = () => (yc() ? "ycloud" : process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID ? "meta" : "");
export const waReady = () => !!waProvider();
export const waFrom = () => (yc() ? process.env.YCLOUD_FROM : "");

// "+39 333 123 4567" -> "393331234567". Italian mobiles without country code get 39, UAE "05…" gets 971.
export function waTo(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^3\d{8,9}$/.test(d)) d = "39" + d;
  else if (/^05\d{8}$/.test(d)) d = "971" + d.slice(1);
  return d.replace(/\D/g, "");
}
// Same person? Compare the last 9 digits (ignores country-code formatting differences).
export const samePhone = (a, b) => { const x = waTo(a), y = waTo(b); return x.length >= 8 && y.length >= 8 && x.slice(-9) === y.slice(-9); };

function fail(msg, code, status) { const e = new Error(msg); e.code = code; e.status = status; return e; }

async function ycloud(body) {
  const res = await fetch(`${YC}/whatsapp/messages/sendDirectly`, {
    method: "POST", signal: AbortSignal.timeout(25000),
    headers: { "X-API-Key": process.env.YCLOUD_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.YCLOUD_FROM, ...body, ...(body.text ? { text: { body: body.text.body } } : {}), to: "+" + body.to }),
  });
  const j = await res.json().catch(() => ({}));
  const wa = j.whatsappApiError || j.error?.whatsappApiError;
  if (!res.ok || j.status === "failed") {
    throw fail(wa?.message || wa?.error_user_msg || j.errorMessage || j.error?.message || `ycloud ${res.status}`, wa?.code || j.errorCode || j.error?.code, res.status);
  }
  return { id: j.id || "", status: j.status || "" };
}

async function meta(body) {
  const res = await fetch(`${META}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = j.error || {}; throw fail(e.error_user_msg || e.message || `whatsapp ${res.status}`, e.code, res.status); }
  return { id: j.messages?.[0]?.id || "" };
}

const call = (body) => (yc() ? ycloud(body) : meta(body));

// Free text: only allowed within 24 h after the person last wrote to this number.
export const sendText = (to, text) => call({ to: waTo(to), type: "text", text: { body: String(text).slice(0, 4000), preview_url: true } });

// Approved template (works any time). params: body variables in order.
export const sendTemplate = (to, name, lang = "pt_BR", params = []) => call({
  to: waTo(to), type: "template",
  template: { name, language: { code: lang }, ...(params.length ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t).slice(0, 1000) })) }] } : {}) },
});

// Error codes that mean "outside the 24 h window, use a template".
export const needsTemplate = (e) => [131047, 131051, 470].includes(Number(e?.code)) || /24.?hour|re-?engagement|customer service window/i.test(String(e?.message || ""));

// Register the inbound webhook at YCloud (once). Returns { url, secret }.
export async function ycloudHook(url) {
  const res = await fetch(`${YC}/webhookEndpoints`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "X-API-Key": process.env.YCLOUD_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ url, enabledEvents: ["whatsapp.inbound_message.received", "whatsapp.smb.message.echoes"], description: "Operator Studio CRM" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(j.error?.message || `ycloud hook ${res.status}`, j.error?.code, res.status);
  return { id: j.id || "", secret: j.secret || "" };
}
