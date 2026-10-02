/**
 * server.ts — API HTTP (Hono) y orquestación del ciclo del agente.
 * Endpoints: POST /api/chat (SSE o JSON), GET /api/sessions/:id, GET /api/health.
 * Sirve el front estático desde web/dist en producción.
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { GeminiAdapter } from "./llm/gemini.js";
import type { LlmAdapter } from "./llm/adapter.js";
import { ejecutarTurno, type EventoAgente } from "./agent/ciclo.js";
import { obtenerSesion, agregarMensaje, sumarTokens, excedioTope, limpiarSesion } from "./agent/sesiones.js";
import type { ToolContext } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, ".."); // raíz del proyecto (reto-02/)
const WEB_DIST = join(RAIZ, "web", "dist");

// Carga .env si existe (Node no lo hace solo). En Render las vars vienen del entorno,
// así que la ausencia de .env no es error.
try {
  const envPath = join(RAIZ, ".env");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
} catch {
  // sin .env: se usan las variables del entorno del sistema (producción)
}

// Cargar system prompt (comportamiento) desde archivo, no embebido.
const SYSTEM_PROMPT = readFileSync(join(RAIZ, "agent", "prompt.md"), "utf8");

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const PORT = Number(process.env.PORT ?? 8000);

// Adaptador LLM: se crea perezosamente para que /api/health y el front funcionen sin key.
let llm: LlmAdapter | null = null;
function obtenerLlm(): { llm: LlmAdapter | null; error: string | null } {
  if (llm) return { llm, error: null };
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return { llm: null, error: "GOOGLE_API_KEY no configurada en el servidor." };
  try {
    llm = new GeminiAdapter(key, MODEL);
    return { llm, error: null };
  } catch (e) {
    return { llm: null, error: (e as Error).message };
  }
}

const app = new Hono();
app.use("/api/*", cors());

// ── Health ───────────────────────────────────────────────────
app.get("/api/health", (c) => {
  const { error } = obtenerLlm();
  return c.json({ ok: !error, provider: "google", model: MODEL, llm_listo: !error });
});

// ── Historial de sesión ──────────────────────────────────────
app.get("/api/sessions/:id", (c) => {
  const s = obtenerSesion(c.req.param("id"));
  return c.json({
    id: s.id,
    creada: s.creada,
    tokens: s.tokens,
    mensajes: s.historial.map((m) => ({ rol: m.rol, contenido: m.contenido, tool_calls: m.tool_calls })),
  });
});

// ── Limpiar sesión ───────────────────────────────────────────
app.post("/api/sessions/:id/limpiar", (c) => {
  limpiarSesion(c.req.param("id"));
  return c.json({ ok: true });
});

// ── Chat (SSE) ───────────────────────────────────────────────
app.post("/api/chat", async (c) => {
  const body = await c.req.json().catch(() => null) as { sessionId?: string; message?: string } | null;
  if (!body?.sessionId || !body?.message) {
    return c.json({ error: "Faltan sessionId o message." }, 400);
  }
  const { sessionId, message } = body;

  const { llm: adapter, error } = obtenerLlm();
  if (!adapter) {
    return c.json({ error: error ?? "El servicio del modelo no está disponible." }, 503);
  }
  if (excedioTope(sessionId)) {
    return c.json({ error: "La sesión alcanzó su tope de tokens. Inicia una nueva sesión." }, 429);
  }

  const ctx: ToolContext = { directory: RAIZ, sessionId };
  agregarMensaje(sessionId, { rol: "user", contenido: message });
  const sesion = obtenerSesion(sessionId);

  return streamSSE(c, async (stream) => {
    const emitir = (e: EventoAgente) => {
      void stream.writeSSE({ event: e.tipo, data: JSON.stringify(e) });
    };
    const resultado = await ejecutarTurno(adapter, SYSTEM_PROMPT, sesion.historial, ctx, emitir);

    agregarMensaje(sessionId, { rol: "assistant", contenido: resultado.reply });
    sumarTokens(sessionId, resultado.tokens);

    await stream.writeSSE({
      event: "fin",
      data: JSON.stringify({
        reply: resultado.reply,
        toolCalls: resultado.toolCalls,
        needsConfirmation: resultado.needsConfirmation,
      }),
    });
  });
});

// ── Front estático (producción) ──────────────────────────────
if (existsSync(WEB_DIST)) {
  app.use("/*", serveStatic({ root: join("web", "dist") }));
  app.get("/", serveStatic({ path: join("web", "dist", "index.html") }));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[servidor] Reto 02 escuchando en http://localhost:${info.port}`);
  console.log(`[servidor] Modelo: ${MODEL} · LLM listo: ${!obtenerLlm().error}`);
});
