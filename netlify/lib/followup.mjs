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
<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#5F594F;">Mentoria individual de 8 semanas · começa na <b style="color:#151412;">semana do dia 26 de outubro</b>${prazo ? ` · condição válida até <b style="color:#151412;">${esc(prazo)}</b>` : ""}</p>
</td></tr></table>`;

export function followupEmail(lead, kind, prazo) {
  const n = esc(first(lead.nome)) || "tudo bem";
  if (kind === "lembrete") {
    const ate = prazo ? esc(prazo) : "amanhã";
    return {
      subject: `${first(lead.nome) || "Oi"}, a decisão da mentoria fecha ${prazo ? `em ${prazo}` : "amanhã"}`,
      html: shell(`<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;">Oi, ${n}! Tudo bem?</h1>
${P("Foi muito bom conversar com você na nossa sessão.")}
${P(`Passando pra lembrar que a decisão sobre a mentoria fica aberta até <b style="color:#151412;">${ate}</b>. O primeiro grupo começa na semana do dia 26 de outubro.`)}
${offer(prazo)}
${P("Se quiser rever a apresentação antes de decidir, ela está aqui:")}
${button("Ver a apresentação")}
${P("Se ficou alguma dúvida sobre o programa, o investimento ou os horários, é só responder este e-mail que eu te respondo.")}
${P("E se não for o momento, tudo bem também!")}`),
    };
  }
  if (kind === "faltou") {
    return {
      subject: `${first(lead.nome) || "Oi"}, ficou faltando a nossa conversa`,
      html: shell(`<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;">Oi, ${n}! Tudo bem?</h1>
${P("Hoje acabou não dando certo da gente se falar, mas sem problema nenhum, acontece com todo mundo. Obrigado por ter reservado o seu horário.")}
${P("Mesmo assim, quis te mandar a apresentação que eu mostrei nas análises. Dá uma olhada quando tiver um tempinho:")}
${button("Ver a apresentação")}
${P("Uma coisa importante: a turma da mentoria começa na semana do dia 26 de outubro, e como é tudo individual, 1 a 1 comigo, as vagas são poucas.")}
${offer(prazo)}
${P("Se quiser, a gente ainda consegue fazer a sua análise antes disso. Me responde aqui com um dia e horário bons pra você que eu encaixo.")}`),
    };
  }
  return {
    subject: `${first(lead.nome) || "Oi"}, obrigado pela conversa de hoje`,
    html: shell(`<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;">Oi, ${n}! Obrigado pelo papo de hoje.</h1>
${P("Sério, obrigado pelo seu tempo. Sei que a rotina de quem empreende é corrida, e eu curti muito conhecer melhor o seu negócio.")}
${P("Como prometido, aqui está a apresentação que a gente viu juntos, pra você rever com calma:")}
${button("Ver a apresentação")}
${P("Agora a decisão é sua, e sem pressão. Só queria te deixar por dentro:")}
${P("A próxima turma da mentoria começa na semana do dia 26 de outubro. São 8 semanas, 1 a 1 comigo, e toda semana sai alguma coisa nova funcionando no seu negócio. Como é tudo individual, eu abro poucas vagas.")}
${offer(prazo)}
${P(`Se fizer sentido pra você, é só responder este e-mail que eu te mando os próximos passos e já libero o seu acesso ao Student Hub.`)}
${P("E se ficou alguma dúvida, me chama. Vou adorar construir isso junto com você.")}`),
  };
}

const quiet = (email) => !LIVE || !email || /@example\.(com|org)$/i.test(email);

export async function sendFollowup(lead, kind, prazo) {
  if (quiet(lead.email)) return "skipped";
  const { subject, html } = followupEmail(lead, kind, prazo);
  const res = await fetch(HOOK, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
    body: JSON.stringify({ type: "reminder", id: kind === "lembrete" ? `lembrete-${lead.id}` : `followup-${lead.id}`, to: lead.email, toName: lead.nome, bcc: OWNER, subject, html, meet: "", event: null }),
  });
  if (!res.ok) throw new Error(`make ${res.status}`);
  return "sent";
}
