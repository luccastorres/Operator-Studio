import { HOOK, OWNER, SITE, LIVE } from "./notify.mjs";

// Welcome e-mail for a new mentee: welcome, how the 8 weeks work, Student Hub invite and the onboarding form.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const first = (n) => String(n || "").trim().split(/\s+/)[0];
const P = (t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#3F3A33;">${t}</p>`;
const btn = (label, href, dark = true) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 10px;"><tr><td style="background:${dark ? "#151412" : "#FBFAF7"};border:1px solid #151412;border-radius:999px;"><a href="${href}" style="display:inline-block;padding:14px 26px;font-size:15px;color:${dark ? "#F3F1EC" : "#151412"};text-decoration:none;">${label}</a></td></tr></table>`;
const step = (n, title, text) => `<tr><td style="padding:12px 0;border-top:1px solid #D9D3C9;vertical-align:top;width:36px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#7E7669;">${n}</td><td style="padding:12px 0;border-top:1px solid #D9D3C9;"><p style="margin:0;font-size:15px;font-weight:bold;color:#151412;">${title}</p><p style="margin:4px 0 0;font-size:14.5px;line-height:1.55;color:#5F594F;">${text}</p></td></tr>`;

export function welcomeEmail({ person, partner, inviteUrl, formUrl, start, note }) {
  const n = esc(first(person.nome));
  const who = partner ? `você, ${esc(first(partner.nome))} e eu vamos construir` : "a gente vai construir junto";
  const inner = `<h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.15;">Boas-vindas à mentoria, ${n}!</h1>
${P(`Que bom ter você aqui. Nas próximas 8 semanas, ${who} um sistema novo por semana para o seu negócio ganhar tempo: IA no dia a dia, automações, CRM, agenda, site e conteúdo.${start ? ` A nossa primeira aula é <b style="color:#151412;">${esc(start)}</b>.` : ""}`)}
${note ? P(esc(note)) : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;">
${step("1", "Responda antes da 1ª aula", "Umas perguntas rápidas sobre o seu negócio, onde vai o seu tempo e o que mais dói hoje. Leva uns 7 minutos e é com isso que eu preparo a nossa primeira aula.")}
${step("2", "Crie a sua senha no Student Hub", "É o seu espaço da mentoria: materiais de cada semana, agenda das aulas, a sala ao vivo e a comunidade.")}
${step("3", "Entre na aula pelo Hub", "A sala abre 10 minutos antes. Depois de cada aula, o resumo com as suas perguntas e tarefas aparece lá.")}
</table>
${btn("Responder antes da 1ª aula", formUrl)}
${inviteUrl ? btn("Criar minha senha no Student Hub", inviteUrl, false) : ""}
${P(`<span style="font-size:14px;color:#7E7669;">Qualquer dúvida, é só responder este e-mail ou me chamar no WhatsApp.</span>`)}`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F1EC;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;font-family:Helvetica,Arial,sans-serif;color:#151412;">
<tr><td style="padding:0 4px 28px;font-family:Georgia,'Times New Roman',serif;font-size:22px;"><b>Operator</b> <i style="color:#7E7669;">Studio</i></td></tr>
<tr><td style="background:#FBFAF7;border:1px solid #D9D3C9;border-radius:20px;padding:36px 32px;">${inner}
<p style="margin:26px 0 0;font-size:16px;line-height:1.6;">Um abraço,<br><b>Luccas Torres</b><br><span style="color:#7E7669;">Operator Studio · @luccastorres</span></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: `Boas-vindas à mentoria, ${first(person.nome)}`, html };
}

export async function sendWelcome(to, toName, mail, id) {
  if (!LIVE || !to || /@example\.(com|org)$/i.test(to)) return "skipped";
  const res = await fetch(HOOK, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
    body: JSON.stringify({ type: "reminder", id, to, toName, bcc: OWNER, subject: mail.subject, html: mail.html, meet: "", event: null }),
  });
  if (!res.ok) throw new Error(`make ${res.status}`);
  return "sent";
}
export const formUrlOf = (t) => `${SITE}/boas-vindas/?t=${t}`;
export const inviteUrlOf = (t) => (t ? `${SITE}/hub/?convite=${t}` : "");
