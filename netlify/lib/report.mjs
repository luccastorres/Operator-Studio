// Turns a live class transcript into a class report with Claude.
//
// Store "hub":
//   live/<start>/<chunk>   transcript lines sent by the classroom (mentor and student browsers)
//   transcripts/<start>    merged transcript { lines, text, minutes }
//   reports/<start>        { status, shared, report, ... }

const MODEL = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

export async function mergedLines(store, start) {
  const { blobs } = await store.list({ prefix: `live/${start}/` });
  const chunks = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  const all = chunks.flatMap((c) => c?.lines || []).filter((l) => l.text).sort((a, b) => a.ts - b.ts);
  // Both browsers receive the same transcript: drop repeats (same speaker, same text, within 15 s).
  const ids = {}, lines = [];
  for (const l of all) if (l.uid) ids[l.pid] = { uid: l.uid, name: l.name };
  for (const l of all) {
    if (lines.some((x) => x.pid === l.pid && x.text === l.text && Math.abs(x.ts - l.ts) < 15000)) continue;
    const id = ids[l.pid] || {};
    const uid = l.uid || id.uid || "";
    lines.push({ ...l, uid, name: l.name || id.name || "", role: uid === "mentor" ? "mentor" : "student" });
  }
  return lines;
}

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

// Consecutive lines from the same speaker become one paragraph (fewer tokens, easier to read).
export function transcriptText(lines, student) {
  if (!lines.length) return { text: "", paras: [], minutes: 0 };
  const t0 = lines[0].ts, paras = [];
  for (const l of lines) {
    const who = l.role === "mentor" ? "Luccas (mentor)" : `${(l.name || student?.nome || "Aluno").split(" ")[0]} (aluno)`;
    const last = paras[paras.length - 1];
    if (last && last.who === who && l.ts - last.end < 20000) { last.text += " " + l.text; last.end = l.ts; }
    else paras.push({ at: mmss(l.ts - t0), who, role: l.role, text: l.text, end: l.ts });
  }
  const text = paras.map((p) => `[${p.at}] ${p.who}: ${p.text}`).join("\n");
  return { text, paras: paras.map(({ end, ...p }) => p), minutes: Math.round((lines[lines.length - 1].ts - t0) / 60000) };
}

const TOOL = {
  name: "relatorio_aula",
  description: "Registra o relatório da aula individual de mentoria.",
  input_schema: {
    type: "object",
    properties: {
      resumo: { type: "string", description: "3 a 5 frases sobre o que aconteceu na aula, escritas para o aluno ler." },
      perguntas: {
        type: "array", description: "TODAS as perguntas e dúvidas que o aluno levantou, na ordem em que aconteceram.",
        items: { type: "object", properties: {
          momento: { type: "string", description: "mm:ss da transcrição" },
          pergunta: { type: "string", description: "A pergunta do aluno, reescrita de forma clara e curta." },
          resposta: { type: "string", description: "O que o mentor respondeu, em 1 a 3 frases. Se não foi respondida, escreva 'Ficou em aberto'." },
        }, required: ["momento", "pergunta", "resposta"] },
      },
      construido: { type: "array", items: { type: "string" }, description: "O que foi construído, configurado ou decidido durante a aula." },
      tarefas: {
        type: "array", description: "Tarefas combinadas para o aluno até a próxima sessão.",
        items: { type: "object", properties: { tarefa: { type: "string" }, prazo: { type: "string", description: "Se foi combinado, senão vazio." } }, required: ["tarefa"] },
      },
      proximo_passo: { type: "string", description: "O próximo passo principal da mentoria." },
      pontos_atencao: { type: "array", items: { type: "string" }, description: "Só para o mentor: onde o aluno teve dificuldade, o que reforçar, riscos." },
      ideias_mentor: { type: "array", items: { type: "string" }, description: "Só para o mentor: oportunidades percebidas (ex.: algo que podemos implementar para o aluno, conteúdo para outros alunos)." },
      engajamento: { type: "string", enum: ["alto", "médio", "baixo"] },
      engajamento_nota: { type: "string", description: "Só para o mentor: uma frase justificando o nível de engajamento." },
    },
    required: ["resumo", "perguntas", "construido", "tarefas", "proximo_passo", "pontos_atencao", "engajamento"],
  },
};

function prompt({ student, week, material, transcript, minutes }) {
  return `Você é o assistente do Luccas Torres, mentor da Operator Studio (mentoria individual de 8 semanas que ensina empresários a usar IA, automações, sistemas, website e conteúdo no próprio negócio).

Abaixo está a transcrição automática de uma aula individual ao vivo. A transcrição pode ter erros de reconhecimento de voz: interprete pelo contexto e não invente nada que não esteja nela.

Aluno: ${student?.nome || "Aluno"}${student?.negocio ? ` · negócio: ${student.negocio}` : ""}
Semana ${week || "?"} da mentoria${material ? `: ${material.title}. ${material.summary || ""}` : ""}
Duração aproximada: ${minutes} minutos

Gere o relatório da aula em português do Brasil, em tom natural e direto (sem frases de IA, sem exageros). Liste TODAS as perguntas e dúvidas do aluno, mesmo as pequenas. Nas tarefas, inclua só o que foi realmente combinado. Responda chamando a ferramenta relatorio_aula (obrigatório). Se não conseguir usar a ferramenta, responda só com um objeto JSON com os mesmos campos.

<transcricao>
${transcript}
</transcricao>`;
}

export async function callClaude(input) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY ausente");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL(), max_tokens: 6000,
      tools: [TOOL], tool_choice: { type: "auto" },
      messages: [{ role: "user", content: prompt(input) }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status}: ${j?.error?.message || "erro"}`);
  const use = (j.content || []).find((c) => c.type === "tool_use" && c.name === TOOL.name);
  if (use) return { report: use.input, usage: j.usage, model: j.model };
  // Fallback: the model answered in text. Take the JSON object from it.
  const txt = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { return { report: JSON.parse(m[0]), usage: j.usage, model: j.model }; } catch {} }
  throw new Error("Claude não devolveu o relatório");
}

export async function buildReport(store, start) {
  const prev = (await store.get(`reports/${start}`, { type: "json" })) || {};
  const base = { start, shared: !!prev.shared, studentId: prev.studentId };
  try {
    const slot = await store.get(`slots/${start}`, { type: "json" });
    const studentId = slot?.studentId || prev.studentId;
    const student = studentId ? await store.get(`students/${studentId}`, { type: "json" }) : null;
    const week = slot?.week || prev.week;
    const material = week ? await store.get(`materials/${week}`, { type: "json" }) : null;
    const lines = await mergedLines(store, start);
    const { text, paras, minutes } = transcriptText(lines, student);
    await store.setJSON(`transcripts/${start}`, { start, paras, minutes, count: lines.length, updatedAt: new Date().toISOString() });
    const meta = { ...base, studentId, week, studentName: student?.nome || prev.studentName || "", minutes };
    if (!text || lines.length < 3) {
      await store.setJSON(`reports/${start}`, { ...meta, status: "empty", updatedAt: new Date().toISOString() });
      return "empty";
    }
    const out = await callClaude({ student, week, material, transcript: text, minutes });
    await store.setJSON(`reports/${start}`, { ...meta, status: "done", report: out.report, model: out.model, usage: out.usage, updatedAt: new Date().toISOString() });
    return "done";
  } catch (e) {
    await store.setJSON(`reports/${start}`, { ...prev, ...base, status: "error", error: String(e.message || e).slice(0, 300), updatedAt: new Date().toISOString() });
    return "error";
  }
}
