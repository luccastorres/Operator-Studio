import { HOOK, OWNER, LIVE, SITE } from "./notify.mjs";

// Payment reminders for mentoring installments (CRM field "pay").
// E-mails Luccas 3 days before, on the due day, and 3 days after if still unpaid. Each one is sent once.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dubaiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const eur = (n) => "€ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const fdate = (d) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(d + "T12:00:00Z"));

export function stepFor(due, today = dubaiToday()) {
  const d = days(today, due); // days until due
  if (d === 3) return "d-3";
  if (d === 0) return "d0";
  if (d === -3) return "d+3";
  return "";
}

function mail(lead, item, step) {
  const who = lead.nome + (lead.socioNome ? ` e ${lead.socioNome}` : "");
  const head = step === "d-3" ? `Daqui a 3 dias: ${eur(item.amount)} de ${who}` : step === "d0" ? `Hoje: ${eur(item.amount)} de ${who}` : `Atrasado 3 dias: ${eur(item.amount)} de ${who}`;
  const paid = (lead.pay.items || []).filter((x) => x.paid).reduce((a, x) => a + x.amount, 0);
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body style="margin:0;background:#F3F1EC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC;"><tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:Helvetica,Arial,sans-serif;color:#151412;">
<tr><td style="padding:0 4px 22px;font-family:Georgia,serif;font-size:20px;"><b>Operator</b> <i style="color:#7E7669;">Studio</i></td></tr>
<tr><td style="background:#FBFAF7;border:1px solid #D9D3C9;border-radius:18px;padding:30px 28px;">
<p style="margin:0 0 10px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7E7669;">Lembrete de pagamento</p>
<p style="margin:0 0 14px;font-family:Georgia,serif;font-size:26px;line-height:1.15;">${esc(head)}</p>
<p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:#3F3A33;">Parcela de <b>${eur(item.amount)}</b> com vencimento em <b>${esc(fdate(item.due))}</b>.</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3F3A33;">Total da mentoria: ${eur(lead.pay.total)} · já recebido: ${eur(paid)}.</p>
<a href="${SITE}/crm/" style="display:inline-block;background:#151412;color:#F3F1EC;text-decoration:none;border-radius:999px;padding:12px 22px;font-size:15px;">Abrir o CRM</a>
<p style="margin:18px 0 0;font-size:13px;color:#7E7669;">Quando receber, marque a parcela como paga na ficha do aluno.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: head, html };
}

export async function runPayReminders(crm) {
  if (!LIVE) return {};
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hour < 8) return { wait: "before 8:00 Dubai" };
  const { blobs } = await crm.list();
  const today = dubaiToday(), out = {};
  for (const b of blobs) {
    const lead = await crm.get(b.key, { type: "json" });
    if (!lead?.pay?.items?.length) continue;
    let changed = false;
    for (const it of lead.pay.items) {
      if (it.paid || !it.due) continue;
      const step = stepFor(it.due, today);
      if (!step || (it.reminded || []).includes(step)) continue;
      const { subject, html } = mail(lead, it, step);
      try {
        const res = await fetch(HOOK, {
          method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000),
          body: JSON.stringify({ type: "reminder", id: `pay-${b.key}-${it.id}-${step}`, to: OWNER, toName: "Luccas", bcc: "", subject, html, meet: "", event: null }),
        });
        if (!res.ok) throw new Error(`make ${res.status}`);
        it.reminded = [...(it.reminded || []), step]; changed = true; out[`${b.key}:${it.id}`] = step;
      } catch (e) { out[`${b.key}:${it.id}`] = "error " + e.message; }
    }
    if (changed) await crm.setJSON(b.key, lead);
  }
  return out;
}
