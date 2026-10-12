// Booking notifications: confirmation (creates the Google Meet) and 24h reminder.
// Emails are rendered here and sent by the Make scenario "Operator Studio — booking emails",
// which creates the Google Calendar event with Meet and sends from luccas.torres@me.com.

const HOOK = "https://hook.eu1.make.com/jbhtec9y6oxfn884deoqt4354wcji3k0";
const OWNER = "luccas.torres@me.com";
const SITE = "https://operator-studio.netlify.app";

const DOW = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MON = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function romeToUtc(slot) {
  const guess = new Date(slot + ":00Z");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(guess);
  const g = (t) => parts.find((p) => p.type === t).value;
  const asRome = new Date(`${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:00Z`);
  return new Date(guess.getTime() - (asRome.getTime() - guess.getTime()));
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";

function when(slot) {
  const d = new Date(slot.slice(0, 10) + "T12:00:00Z");
  const dow = DOW[d.getUTCDay()];
  return {
    long: `${dow.charAt(0).toUpperCase() + dow.slice(1)}, ${+slot.slice(8, 10)} de ${MON[+slot.slice(5, 7) - 1]}`,
    time: slot.slice(11, 16),
    short: `${dow.slice(0, 3)} ${+slot.slice(8, 10)}/${slot.slice(5, 7)}`,
  };
}

function gcalLink(rec, start, end) {
  const f = (x) => x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const det = "Análise gratuita de 30 minutos com Luccas Torres · Operator Studio\nVideochamada: __MEET__";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("Análise · Operator Studio")}&dates=${f(start)}/${f(end)}&details=${encodeURIComponent(det)}`;
}

function layout({ eyebrow, title, intro, rec, start, end, closing }) {
  const w = when(rec.slot);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F1EC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Helvetica,Arial,sans-serif;color:#151412;">
<tr><td style="padding:0 4px 28px;font-family:Georgia,'Times New Roman',serif;font-size:22px;"><b>Operator</b> <i style="color:#7E7669;">Studio</i></td></tr>
<tr><td style="background:#FBFAF7;border:1px solid #D9D3C9;border-radius:20px;padding:36px 32px;">
  <p style="margin:0 0 10px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#7E7669;">${eyebrow}</p>
  <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.15;font-weight:700;">${title}</h1>
  <p style="margin:0 0 26px;font-size:16px;line-height:1.6;color:#5F594F;">${intro}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC;border-radius:14px;"><tr><td style="padding:20px 22px;">
    <p style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7E7669;">Data e horário</p>
    <p style="margin:6px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;">${w.long} · ${w.time}</p>
    <p style="margin:4px 0 0;font-size:14px;color:#5F594F;">Horário de Milão · 30 minutos · videochamada</p>
  </td></tr></table>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 10px;"><tr><td style="background:#151412;border-radius:999px;">
    <a href="__MEET__" style="display:inline-block;padding:14px 26px;font-size:15px;color:#F3F1EC;text-decoration:none;">Entrar na videochamada</a>
  </td></tr></table>
  <p style="margin:0 0 4px;font-size:13px;color:#7E7669;">Google Meet: <a href="__MEET__" style="color:#7E7669;">__MEET__</a></p>
  <p style="margin:0 0 26px;font-size:13px;"><a href="${esc(gcalLink(rec, start, end))}" style="color:#151412;">Adicionar à minha agenda</a></p>
  <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#5F594F;">${closing}</p>
  <p style="margin:0;font-size:16px;line-height:1.6;">Até lá,<br><b>Luccas Torres</b><br><span style="color:#7E7669;">Operator Studio</span></p>
</td></tr>
<tr><td style="padding:22px 4px 0;font-size:12px;line-height:1.6;color:#7E7669;">Precisa remarcar? É só responder este e-mail.<br><a href="${SITE}" style="color:#7E7669;">operator-studio.netlify.app</a> · @luccastorres</td></tr>
</table></td></tr></table></body></html>`;
}

export function buildPayload(type, rec) {
  const start = romeToUtc(rec.slot);
  const end = new Date(start.getTime() + 30 * 60000);
  const w = when(rec.slot);
  const n = esc(first(rec.nome));
  let subject, html;
  if (type === "confirmation") {
    subject = `Confirmado: sua análise com a Operator Studio · ${w.long}, ${w.time}`;
    html = layout({
      eyebrow: "Análise confirmada",
      title: `Tudo certo, ${n}.`,
      intro: `Sua análise gratuita de 30 minutos está marcada. Vamos olhar juntos para o seu negócio${rec.negocio ? ", o " + esc(rec.negocio) + "," : ""} e descobrir onde a IA pode trabalhar por você.`,
      rec, start, end,
      closing: "Para aproveitar bem o tempo, pense em uma ou duas tarefas que mais tomam o seu dia hoje. É por elas que a gente começa.",
    });
  } else {
    subject = `Amanhã: sua análise com a Operator Studio · ${w.time}`;
    html = layout({
      eyebrow: "Lembrete · amanhã",
      title: `Nos vemos amanhã, ${n}.`,
      intro: "Passando para lembrar da nossa conversa de 30 minutos. O link da videochamada está logo abaixo.",
      rec, start, end,
      closing: "Se puder, entre de um lugar tranquilo e com o computador ou o celular à mão. Vai ser rápido e prático.",
    });
  }
  if (rec.meet) html = html.split("__MEET__").join(esc(rec.meet));
  return {
    type,
    id: rec.slot,
    to: rec.email,
    toName: rec.nome,
    bcc: OWNER,
    subject,
    html,
    meet: rec.meet || "",
    event: {
      summary: `Análise · ${rec.nome}${rec.negocio ? " (" + rec.negocio + ")" : ""}`,
      start: start.toISOString(),
      end: end.toISOString(),
      description: [
        rec.negocio && `Negócio: ${rec.negocio}`, rec.setor && `Setor: ${rec.setor}`,
        rec.whatsapp && `WhatsApp: ${rec.whatsapp}`, rec.email && `E-mail: ${rec.email}`,
        rec.desafio && `Desafio: ${rec.desafio}`, `CRM: ${SITE}/crm/`,
      ].filter(Boolean).join("\n"),
    },
  };
}

// Calls Make. For a confirmation, Make answers {"meet": "<google meet url>"}.
export async function send(type, rec) {
  const res = await fetch(HOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildPayload(type, rec)),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`make ${res.status}`);
  let meet = "";
  try {
    const t = await res.text();
    const j = JSON.parse(t);
    meet = j.meet || "";
  } catch {}
  return { meet };
}

const LOCK_MS = 5 * 60000;
// Safety switch: real customer emails go out only when LIVE is true.
export const LIVE = true;

// Sends whatever is due for one booking and records it. Safe to call repeatedly.
export async function processBooking(store, key, now = new Date()) {
  if (!LIVE) return "not-live";
  const rec = await store.get(key, { type: "json" });
  if (!rec || !rec.email || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rec.slot || "")) return "skip";
  const start = romeToUtc(rec.slot);
  if (start <= now) return "past";
  if (rec.sendingAt && now - new Date(rec.sendingAt) < LOCK_MS) return "locked";

  let type = null;
  if (!rec.confirmedAt) type = "confirmation";
  else if (!rec.remindedAt) {
    const left = start - now;
    const bookedAhead = start - new Date(rec.createdAt || rec.confirmedAt);
    if (bookedAhead < 26 * 3600000) {
      // booked less than ~a day ahead: the confirmation already does the job
      await store.setJSON(key, { ...rec, remindedAt: "skipped" });
      return "skip-reminder";
    }
    if (left <= 24 * 3600000 && left > 60 * 60000) type = "reminder";
  }
  if (!type) return "nothing";

  await store.setJSON(key, { ...rec, sendingAt: now.toISOString() });
  try {
    const { meet } = await send(type, rec);
    const next = { ...rec, sendingAt: null };
    if (type === "confirmation") { next.confirmedAt = new Date().toISOString(); if (meet) next.meet = meet; }
    else next.remindedAt = new Date().toISOString();
    await store.setJSON(key, next);
    return type;
  } catch (e) {
    await store.setJSON(key, { ...rec, sendingAt: null, lastError: String(e.message || e) });
    return "error";
  }
}
