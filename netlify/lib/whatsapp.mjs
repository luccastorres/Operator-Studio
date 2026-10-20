// WhatsApp Cloud API (Meta). Env: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID.
const API = "https://graph.facebook.com/v21.0";

export const waReady = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

// "+39 333 123 4567" -> "393331234567". Italian mobiles written without the country code get +39.
export function waTo(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1); else if (d.startsWith("00")) d = d.slice(2); else if (/^3\d{8,9}$/.test(d)) d = "39" + d;
  return d.replace(/\D/g, "");
}

async function call(body) {
  const res = await fetch(`${API}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = j.error || {};
    const err = new Error(e.error_user_msg || e.message || `whatsapp ${res.status}`);
    err.code = e.code; err.sub = e.error_subcode; err.status = res.status;
    throw err;
  }
  return { id: j.messages?.[0]?.id || "" };
}

// Free text: only allowed within 24 h after the person last wrote to this number.
export const sendText = (to, text) => call({ to: waTo(to), type: "text", text: { body: String(text).slice(0, 4000), preview_url: true } });

// Approved template (works any time). params: body variables in order.
export const sendTemplate = (to, name, lang = "pt_BR", params = []) => call({
  to: waTo(to), type: "template",
  template: { name, language: { code: lang }, ...(params.length ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t).slice(0, 1000) })) }] } : {}) },
});

// Meta error codes that mean "outside the 24 h window, use a template".
export const needsTemplate = (e) => [131047, 131051, 470].includes(Number(e?.code));
