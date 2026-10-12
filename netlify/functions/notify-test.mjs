import { createHash } from "node:crypto";
import { send } from "../lib/notify.mjs";

// Owner-only test: sends a sample confirmation (and optionally reminder) to luccas.torres@me.com.
// GET /api/notify-test?k=<calendar token>&type=confirmation|reminder
const TOKEN_HASH = "7a38aeb9e5d1dae8429d00e1e3c92ddf5636c0fd3523b52d386b42ecd3810896";

export default async (req) => {
  const url = new URL(req.url);
  const k = url.searchParams.get("k") || "";
  if (createHash("sha256").update(k).digest("hex") !== TOKEN_HASH) return new Response("Not found", { status: 404 });
  const type = url.searchParams.get("type") === "reminder" ? "reminder" : "confirmation";
  const rec = {
    slot: "2026-10-19T12:00", nome: "Luccas (teste)", email: "luccas.torres@me.com",
    negocio: "Operator Studio", setor: "Teste", whatsapp: "", desafio: "Teste do fluxo de e-mails",
    createdAt: new Date().toISOString(), meet: url.searchParams.get("meet") || "",
  };
  try {
    const r = await send(type, rec);
    return Response.json({ ok: true, type, ...r }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
};

export const config = { path: "/api/notify-test" };
