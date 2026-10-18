import { callTool } from "./report.mjs";

// Report of the free 30-minute analysis call, built from a pasted transcript (Tactiq / Google Meet).
// Store "calls": <leadId> -> { text, at }. Result goes into the CRM lead meta as `call`.

const TOOL = {
  name: "relatorio_analise",
  description: "Registra o relatório da análise gratuita de 30 minutos com um potencial cliente.",
  input_schema: {
    type: "object",
    properties: {
      resumo: { type: "string", description: "3 a 5 frases: quem é a pessoa, o negócio e o que foi conversado." },
      perguntas: {
        type: "array", description: "TODAS as perguntas e dúvidas que a pessoa fez, na ordem.",
        items: { type: "object", properties: {
          pergunta: { type: "string" },
          resposta: { type: "string", description: "O que o Luccas respondeu, em 1 a 2 frases. Se não respondeu, 'Ficou em aberto'." },
        }, required: ["pergunta", "resposta"] },
      },
      dores: { type: "array", items: { type: "string" }, description: "Os problemas e frustrações que a pessoa contou do negócio, com as palavras dela quando possível." },
      objecoes: { type: "array", items: { type: "string" }, description: "Hesitações ou objeções (preço, tempo, momento, confiança, sócio...)." },
      interesse: { type: "string", enum: ["alto", "médio", "baixo"], description: "Interesse na mentoria." },
      interesse_nota: { type: "string", description: "Uma frase justificando o nível de interesse." },
      proximo_passo: { type: "string", description: "O que foi combinado no fim da conversa, ou o melhor próximo passo." },
      mensagem_whatsapp: { type: "string", description: "Mensagem curta de follow-up no WhatsApp, em nome do Luccas, tom leve e humano, sem citar dores, retomando algo específico da conversa. Sem emojis em excesso." },
      ficha: {
        type: "object", description: "Ficha da análise preenchida a partir da conversa. Deixe vazio o que não apareceu.",
        properties: {
          dor: { type: "string", description: "Maior dor do negócio" },
          tarefa: { type: "string", description: "Tarefa que mais consome tempo" },
          ferramentas: { type: "string", description: "Ferramentas que usa hoje, separadas por vírgula" },
          scores: { type: "object", description: "Maturidade 1 (manual) a 5 (com IA); 0 se não deu para saber.",
            properties: { at: { type: "integer" }, ag: { type: "integer" }, org: { type: "integer" }, aut: { type: "integer" }, pre: { type: "integer" } } },
          ops: { type: "array", description: "Até 3 processos prioritários para automatizar.",
            items: { type: "object", properties: {
              processo: { type: "string" },
              frente: { type: "string", enum: ["Atendimento", "Agendamento", "CRM", "Automação", "Website", "Conteúdo", "Propostas", "Financeiro"] },
              horas: { type: "number", description: "Horas por semana, se a pessoa disse ou deu para estimar; senão 0" },
              pct: { type: "number", description: "% que dá para automatizar (estimativa)" },
            }, required: ["processo"] } },
          proximo: { type: "string", description: "Recomendação de próximo passo para o relatório do cliente" },
        },
      },
    },
    required: ["resumo", "perguntas", "dores", "objecoes", "interesse", "proximo_passo", "mensagem_whatsapp", "ficha"],
  },
};

// General meeting report (client already in mentoring, project meetings): topics, decisions and actions.
const MEET = {
  name: "relatorio_reuniao",
  description: "Registra o relatório de uma reunião de trabalho com um cliente ou mentorado.",
  input_schema: {
    type: "object",
    properties: {
      resumo: { type: "string", description: "3 a 5 frases: o que a reunião tratou e o que ficou combinado." },
      topicos: { type: "array", description: "Os principais assuntos de trabalho, na ordem em que apareceram. Ignore conversa pessoal.",
        items: { type: "object", properties: { titulo: { type: "string" }, pontos: { type: "array", items: { type: "string" } } }, required: ["titulo", "pontos"] } },
      decisoes: { type: "array", items: { type: "string" }, description: "O que foi decidido." },
      acoes_luccas: { type: "array", items: { type: "string" }, description: "Tarefas do Luccas, com prazo se foi dito." },
      acoes_cliente: { type: "array", items: { type: "string" }, description: "Tarefas do cliente (o que precisa mandar, decidir, fazer)." },
      ideias: { type: "array", items: { type: "string" }, description: "Ideias e oportunidades que surgiram." },
      em_aberto: { type: "array", items: { type: "string" }, description: "Pontos que ficaram sem definição." },
      mensagem_whatsapp: { type: "string", description: "Mensagem curta e leve para o cliente, em nome do Luccas, resumindo os próximos passos." },
    },
    required: ["resumo", "topicos", "decisoes", "acoes_luccas", "acoes_cliente", "em_aberto", "mensagem_whatsapp"],
  },
};
const meetPrompt = (lead, text) => `Você é o assistente do Luccas Torres, da Operator Studio (cria sistemas, sites, CRMs, marca e conteúdo com IA e dá mentoria a empresários).

Abaixo está a transcrição automática (Google Meet / Tactiq) de uma reunião de trabalho com ${lead.nome || "um cliente"}${lead.negocio ? ` (${lead.negocio})` : ""}. Pode ter erros de reconhecimento de voz: interprete pelo contexto e não invente nada. O Luccas é o anfitrião.

Gere o relatório da reunião em português do Brasil, tom natural e direto, focado no que foi tratado de trabalho, nas decisões e nas próximas ações de cada lado. Deixe de fora conversa pessoal, fofoca, assuntos de terceiros e qualquer informação sensível ou privada sobre outras pessoas. Responda chamando a ferramenta relatorio_reuniao (obrigatório). Se não conseguir usar a ferramenta, responda só com um objeto JSON com os mesmos campos.

<transcricao>
${text}
</transcricao>`;

const prompt = (lead, text) => `Você é o assistente do Luccas Torres, da Operator Studio. A Operator Studio oferece uma mentoria individual de 8 semanas (€1.500, oferta de €1.000 em 2× de €500 para o Brasileiros Inspiradores) que ensina empresários a usar IA, automações, sistemas, website e conteúdo no próprio negócio.

Abaixo está a transcrição automática (Google Meet / Tactiq) de uma análise gratuita de 30 minutos com um potencial cliente. Pode ter erros de reconhecimento de voz: interprete pelo contexto e não invente nada que não esteja na conversa. O Luccas é o anfitrião; a outra pessoa é o cliente.

Cliente: ${lead.nome || "?"}${lead.negocio ? ` · negócio: ${lead.negocio}` : ""}${lead.setor ? ` · área: ${lead.setor}` : ""}${lead.desafio ? `\nO que escreveu na reserva: "${lead.desafio}"` : ""}

Gere o relatório em português do Brasil, tom natural e direto. Liste TODAS as perguntas do cliente. Responda chamando a ferramenta relatorio_analise (obrigatório). Se não conseguir usar a ferramenta, responda só com um objeto JSON com os mesmos campos.

<transcricao>
${text}
</transcricao>`;

const clip = (v, n) => String(v ?? "").trim().slice(0, n);

// Fill only the empty fields of the analysis sheet, so nothing typed by hand is overwritten.
function mergeDiag(cur = {}, f = {}) {
  const d = { ...cur, scores: { ...(cur.scores || {}) }, ops: [...(cur.ops || [])] };
  for (const k of ["dor", "tarefa", "ferramentas", "proximo"]) if (!clip(d[k], 1) && f[k]) d[k] = clip(f[k], 600);
  for (const k of ["at", "ag", "org", "aut", "pre"]) {
    const v = Math.round(+f.scores?.[k] || 0);
    if (!(+d.scores[k] > 0) && v >= 1 && v <= 5) d.scores[k] = v;
  }
  if (!d.ops.some((o) => clip(o?.processo, 1))) {
    d.ops = (f.ops || []).slice(0, 3).map((o) => ({ processo: clip(o.processo, 160), frente: clip(o.frente, 40), horas: +o.horas || "", pct: +o.pct || "" }));
  }
  d.updatedAt = new Date().toISOString();
  return d;
}

export async function buildCallReport(crm, calls, bookings, id) {
  const meta = (await crm.get(id, { type: "json" })) || {};
  try {
    const t = await calls.get(id, { type: "json" });
    if (!t?.text) throw new Error("Transcrição vazia");
    const lead = { ...((await bookings.get(id, { type: "json" })) || {}), ...meta };
    const kind = t.kind === "reuniao" ? "reuniao" : "venda";
    const out = kind === "reuniao" ? await callTool(MEET, meetPrompt(lead, t.text), 8000) : await callTool(TOOL, prompt(lead, t.text), 6000);
    const cur = (await crm.get(id, { type: "json" })) || {};
    const next = { ...cur, call: { status: "done", kind, report: out.report, at: t.at, updatedAt: new Date().toISOString() } };
    if (kind === "venda") {
      next.diag = mergeDiag(cur.diag, out.report.ficha || {});
      if (!cur.stage || cur.stage === "agendado" || cur.stage === "novo") next.stage = "analise";
    }
    await crm.setJSON(id, next);
    return "done";
  } catch (e) {
    const cur = (await crm.get(id, { type: "json" })) || {};
    await crm.setJSON(id, { ...cur, call: { ...(cur.call || {}), status: "error", error: String(e.message || e).slice(0, 300), updatedAt: new Date().toISOString() } });
    return "error";
  }
}
