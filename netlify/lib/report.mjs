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
          aluno: { type: "string", description: "Primeiro nome de quem perguntou (importante em aula em grupo)." },
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

function prompt({ student, week, material, transcript, minutes, group }) {
  return `Você é o assistente do Luccas Torres, mentor da Operator Studio (mentoria individual de 8 semanas que ensina empresários a usar IA, automações, sistemas, website e conteúdo no próprio negócio).

Abaixo está a transcrição automática de uma aula individual ao vivo. A transcrição pode ter erros de reconhecimento de voz: interprete pelo contexto e não invente nada que não esteja nela.

${group ? `Aula EM GRUPO: ${group.title}. Participantes: ${group.names.join(", ")}. Em cada pergunta, diga quem perguntou (campo aluno). O resumo é para todo o grupo.` : `Aluno: ${student?.nome || "Aluno"}${student?.negocio ? ` · negócio: ${student.negocio}` : ""}
Semana ${week || "?"} da mentoria${material ? `: ${material.title}. ${material.summary || ""}` : ""}`}
Duração aproximada: ${minutes} minutos

Gere o relatório da aula em português do Brasil, em tom natural e direto (sem frases de IA, sem exageros). Liste TODAS as perguntas e dúvidas do aluno, mesmo as pequenas. Nas tarefas, inclua só o que foi realmente combinado. Responda chamando a ferramenta relatorio_aula (obrigatório). Se não conseguir usar a ferramenta, responda só com um objeto JSON com os mesmos campos.

<transcricao>
${transcript}
</transcricao>`;
}

// Calls Claude with one tool; returns the tool input (or a JSON object from the text as fallback).
// Streams the response: a long class (2h+) can take several minutes to answer, and a
// non-streamed request dies at the HTTP client's 5-minute header timeout ("fetch failed").
async function readStream(res, tool) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", model = "", usage = {}, toolJson = "", text = "", inTool = false, err = null;
  const handle = (ev) => {
    if (ev.type === "message_start") { model = ev.message?.model || ""; usage = { ...(ev.message?.usage || {}) }; }
    else if (ev.type === "content_block_start") inTool = ev.content_block?.type === "tool_use" && ev.content_block?.name === tool.name;
    else if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "input_json_delta" && inTool) toolJson += ev.delta.partial_json || "";
      else if (ev.delta?.type === "text_delta") text += ev.delta.text || "";
    } else if (ev.type === "content_block_stop") inTool = false;
    else if (ev.type === "message_delta") Object.assign(usage, ev.usage || {});
    else if (ev.type === "error") err = ev.error?.message || "erro no streaming";
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (data) { try { handle(JSON.parse(data)); } catch {} }
    }
    if (done) break;
  }
  if (err) throw new Error(`Claude: ${err}`);
  return { model, usage, toolJson, text };
}

export async function callTool(tool, content, maxTokens = 6000) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY ausente");
  const req = () => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL(), max_tokens: maxTokens, stream: true,
      tools: [tool], tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    }),
  });
  let res;
  try { res = await req(); } catch { await new Promise((r) => setTimeout(r, 3000)); res = await req(); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(`Claude ${res.status}: ${j?.error?.message || "erro"}`); }
  let model = "", usage = {}, toolJson = "", text = "";
  if (/event-stream/.test(res.headers.get("content-type") || "")) ({ model, usage, toolJson, text } = await readStream(res, tool));
  else {
    const j = await res.json().catch(() => ({}));
    model = j.model; usage = j.usage;
    const use = (j.content || []).find((c) => c.type === "tool_use" && c.name === tool.name);
    if (use) return { report: use.input, usage, model };
    text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  }
  if (toolJson) { try { return { report: JSON.parse(toolJson), usage, model }; } catch {} }
  const m = (text || "").match(/\{[\s\S]*\}/);
  if (m) { try { return { report: JSON.parse(m[0]), usage, model }; } catch {} }
  throw new Error(toolJson ? "Relatório veio incompleto (aula muito longa)" : "Claude não devolveu o relatório");
}

export const callClaude = (input) => callTool(TOOL, prompt(input), input.minutes > 60 ? 16000 : 8000);

export async function buildReport(store, start) {
  const prev = (await store.get(`reports/${start}`, { type: "json" })) || {};
  const base = { start, shared: !!prev.shared, studentId: prev.studentId };
  try {
    const slot = await store.get(`slots/${start}`, { type: "json" });
    const g = !slot?.studentId ? await store.get(`groups/${start}`, { type: "json" }) : null;
    const gIds = g?.studentIds || prev.studentIds || [];
    const studentId = slot?.studentId || prev.studentId;
    const members = gIds.length ? (await Promise.all(gIds.map((id) => store.get(`students/${id}`, { type: "json" })))).filter(Boolean) : [];
    const student = studentId ? await store.get(`students/${studentId}`, { type: "json" }) : (gIds.length ? { nome: "Aluno" } : null);
    let group = gIds.length ? { title: g?.title || prev.title || "Aula em grupo", names: members.map((m) => m.nome) } : null;
    // Duo mentoring: the session belongs to both partners.
    const partner = !group && student?.partnerId ? await store.get(`students/${student.partnerId}`, { type: "json" }) : null;
    if (partner) { group = { title: `Mentoria em dupla · ${student.nome.split(" ")[0]} e ${partner.nome.split(" ")[0]}`, names: [student.nome, partner.nome] }; gIds.push(student.id, partner.id); }
    if (group) Object.assign(base, { group: true, studentIds: gIds, title: group.title, ...(partner ? { duo: true } : {}) });
    const week = slot?.week || prev.week;
    const material = week ? await store.get(`materials/${week}`, { type: "json" }) : null;
    const lines = await mergedLines(store, start);
    const { text, paras, minutes } = transcriptText(lines, student);
    await store.setJSON(`transcripts/${start}`, { start, paras, minutes, count: lines.length, updatedAt: new Date().toISOString() });
    const meta = { ...base, studentId, week, studentName: group ? (partner ? `${student.nome} e ${partner.nome}` : group.title) : (student?.nome || prev.studentName || ""), minutes };
    if (!text || lines.length < 3) {
      await store.setJSON(`reports/${start}`, { ...meta, status: "empty", updatedAt: new Date().toISOString() });
      return "empty";
    }
    const out = await callClaude({ student, week, material, transcript: text, minutes, group });
    await store.setJSON(`reports/${start}`, { ...meta, status: "done", report: out.report, model: out.model, usage: out.usage, updatedAt: new Date().toISOString() });
    return "done";
  } catch (e) {
    await store.setJSON(`reports/${start}`, { ...prev, ...base, status: "error", error: String(e.message || e).slice(0, 300), updatedAt: new Date().toISOString() });
    return "error";
  }
}
