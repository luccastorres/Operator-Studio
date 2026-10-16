import { HOOK, OWNER, SITE, LIVE } from "./notify.mjs";

// Follow-up e-mail after the free analysis: thanks for the time, the presentation, the offer and the start date.
export const DECK_URL = `${SITE}/analise/apresentacao.pdf`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const first = (n) => String(n || "").trim().split(/\s+/)[0];

function shell(inner) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F1EC;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Helvetica,Arial,sans-serif;color:#151412;">
<tr><td style="padding:0 4px 28px;font-family:Georgia,'Times New Roman',serif;font-size:22px;"><b>Operator</b> <i style="color:#7E7669;">Studio</i></td></tr>
<tr><td style="background:#FBFAF7;border:1px solid #D9D3C9;border-radius:20px;padding:36px 32px;">${inner}
<p style="margin:28px 0 0;font-size:16px;line-height:1.6;">Um abraço,<br><b>Luccas Torres</b><br><span style="color:#7E7669;">Operator Studio · @luccastorres</span></p>
</td></tr><tr><td style="padding:22px 4px 0;font-size:12px;line-height:1.6;color:#7E7669;">Você recebeu este e-mail porque reservou uma análise pelo Brasileiros Inspiradores.</td></tr>
</table></td></tr></table></body></html>`;
}
const P = (t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#3F3A33;">${t}</p>`;
const button = (label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="background:#151412;border-radius:999px;"><a href="${DECK_URL}" style="display:inline-block;padding:14px 26px;font-size:15px;color:#F3F1EC;text-decoration:none;">${label}</a></td></tr></table>`;
const offer = (prazo) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC;border-radius:14px;margin:8px 0 24px;"><tr><td style="padding:22px 22px;">
<p style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7E7669;">Oferta Brasileiros Inspiradores</p>
<p style="margin:10px 0 0;font-size:15px;color:#7E7669;text-decoration:line-through;">€1.500</p>
<p style="margin:2px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;">€1.000 <span style="font-size:18px;font-weight:400;color:#5F594F;">em 2× de €500</span></p>
<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#5F594F;">Mentoria individual de 8 semanas · turma começa em <b style="color:#151412;">26 de outubro</b>${prazo ? ` · condição válida até <b style="color:#151412;">${esc(prazo)}</b>` : ""}</p>
</td></tr></table>`;

export function followupEmail(lead, kind, prazo) {
  const n = esc(first(lead.nome)) || "tudo bem";
  if (kind === "faltou") {
    return {
      subject: `${first(lead.nome) || "Olá"}, a apresentação da sua análise`,
      html: shell(`<p style="margin:0 0 10px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#7E7669;">Sua análise</p>
<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.15;">Oi, ${n}.</h1>
${P("Hoje não conseguimos nos falar, mas quero agradecer por ter reservado o seu horário. Imprevistos acontecem.")}
${P("Preparei a apresentação da análise para você ver com calma: o mapa do que dá para criar no seu negócio, os casos reais e o caminho da mentoria.")}
${button("Ver a apresentação")}
${P("A próxima turma da Mentoria Operator começa no dia 26 de outubro. São 8 semanas, 1 a 1, e como as sessões são individuais, as vagas são poucas.")}
${offer(prazo)}
${P("Se fizer sentido, a gente remarca a sua análise de 30 minutos ainda antes do início da turma. É só responder este e-mail com um dia e horário que funcionam para você.")}`),
    };
  }
  return {
    subject: "Nossa análise de hoje + a turma que começa dia 26",
    html: shell(`<p style="margin:0 0 10px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#7E7669;">Obrigado pela conversa</p>
<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.15;">Obrigado pelo seu tempo, ${n}.</h1>
${P("Sei como a agenda de quem empreende é corrida, e foi muito bom conhecer de perto o seu negócio.")}
${P("Como combinamos, aqui está a apresentação da nossa análise: o mapa do que dá para criar, os casos reais e o caminho da mentoria.")}
${button("Ver a apresentação")}
<p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;">A decisão agora é sua.</p>
${P("A próxima turma da Mentoria Operator começa no dia 26 de outubro. São 8 semanas, 1 a 1, com uma entrega funcionando no seu negócio a cada semana. Como as sessões são individuais, eu abro poucas vagas por turma.")}
${offer(prazo)}
${P("Se você quer começar dia 26, é só responder este e-mail. Eu te mando os próximos passos e você já recebe o acesso ao Student Hub.")}
${P("Daqui a 8 semanas o seu negócio pode estar do mesmo jeito, ou com os sistemas funcionando e mais tempo livre para você. Eu adoraria construir isso junto com você.")}`),
  };
}

const quiet = (email) => !LIVE || !email || /@example\.(com|org)$/i.test(email);

export async function sendFollowup(lead, kind, prazo) {
  if (quiet(lead.email)) return "skipped";
  const { subject, html } = followupEmail(lead, kind, prazo);
  const res = await fetch(HOOK, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
    body: JSON.stringify({ type: "reminder", id: `followup-${lead.id}`, to: lead.email, toName: lead.nome, bcc: OWNER, subject, html, meet: "", event: null }),
  });
  if (!res.ok) throw new Error(`make ${res.status}`);
  return "sent";
}
