import { HOOK, OWNER, LIVE } from "./notify.mjs";

// E-mail with the meeting report, sent to the client from the CRM.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const first = (n) => String(n || "").trim().split(/\s+/)[0];
const H = (t) => `<p style="margin:26px 0 8px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7E7669;">${t}</p>`;
const UL = (a) => `<ul style="margin:0;padding-left:18px;">${a.map((x) => `<li style="margin:0 0 7px;font-size:15px;line-height:1.55;color:#3F3A33;">${esc(x)}</li>`).join("")}</ul>`;
const sec = (t, a) => (a?.length ? H(t) + UL(a) : "");

export function reportEmail(lead, call, note) {
  const r = call.report || {}, n = first(lead.nome);
  const when = new Date(call.at || Date.now()).toLocaleDateString("pt-BR", { day: "numeric", month: "long", timeZone: "Europe/Rome" });
  const inner = `<h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;">Oi, ${esc(n) || "tudo bem"}!</h1>
<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#3F3A33;">${esc(note || "Segue o resumo da nossa reunião, com o que conversamos e os próximos passos de cada um.")}</p>
<div style="border-top:1px solid #D9D3C9;margin:8px 0 0;"></div>
${H(`Resumo · ${esc(when)}`)}<p style="margin:0;font-size:15px;line-height:1.6;color:#3F3A33;">${esc(r.resumo)}</p>
${(r.topicos || []).map((t) => sec(esc(t.titulo), t.pontos)).join("")}
${sec("Decisões", r.decisoes)}${sec("Próximas ações · Luccas", r.acoes_luccas)}${sec(`Próximas ações · ${esc(n || "você")}`, r.acoes_cliente)}${sec("Pontos em aberto", r.em_aberto)}`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F1EC;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:Helvetica,Arial,sans-serif;color:#151412;">
<tr><td style="padding:0 4px 28px;font-family:Georgia,'Times New Roman',serif;font-size:22px;"><b>Operator</b> <i style="color:#7E7669;">Studio</i></td></tr>
<tr><td style="background:#FBFAF7;border:1px solid #D9D3C9;border-radius:20px;padding:36px 32px;">${inner}
<p style="margin:30px 0 0;font-size:16px;line-height:1.6;">Qualquer coisa, me chama.<br>Um abraço,<br><b>Luccas Torres</b><br><span style="color:#7E7669;">Operator Studio · @luccastorres</span></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: `${n ? n + ", " : ""}resumo da nossa reunião`, html };
}

export async function sendReport(lead, call, note) {
  if (!LIVE || !lead.email || /@example\.(com|org)$/i.test(lead.email)) return "skipped";
  const { subject, html } = reportEmail(lead, call, note);
  const res = await fetch(HOOK, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
    body: JSON.stringify({ type: "reminder", id: `report-${lead.id}-${Date.now()}`, to: lead.email, toName: lead.nome, bcc: OWNER, subject, html, meet: "", event: null }),
  });
  if (!res.ok) throw new Error(`make ${res.status}`);
  return "sent";
}
