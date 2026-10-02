/**
 * ciclo.ts — Ciclo del agente (§6.3 del PRD).
 * Bucle: prompt → modelo → tool calls → modelo → … con tope de iteraciones.
 * El modelo solo afirma valores que salen de las herramientas (CA2).
 * Confirmación humana (CA3): si una tool devuelve "requiere revisión/confirmación",
 * el turno termina con needsConfirmation y el front resalta ese estado.
 */

import type { LlmAdapter, LlmMensaje } from "../llm/adapter.js";
import type { ToolContext } from "../types.js";
import { definicionesHerramientas, ejecutarHerramienta } from "./registro-herramientas.js";
import { appendJsonl } from "../lib/io.js";

export interface ToolCallVisible {
  nombre: string;
  argumentos: Record<string, unknown>;
  resultado_resumen: string;
  ok: boolean;
}

export interface EventoAgente {
  tipo: "pensando" | "tool_call" | "tool_result" | "respuesta" | "confirmacion" | "error";
  texto?: string;
  toolCall?: ToolCallVisible;
}

export interface ResultadoTurno {
  reply: string;
  toolCalls: ToolCallVisible[];
  needsConfirmation: boolean;
  tokens: number;
}

const MAX_ITER = Number(process.env.MAX_ITERACIONES ?? 25);

/** Resume el resultado de una herramienta para mostrarlo en el chat (sin volcar todo el JSON). */
function resumirResultado(raw: string): { ok: boolean; resumen: string } {
  try {
    const r = JSON.parse(raw) as { ok: boolean; data?: unknown; error?: string };
    if (!r.ok) return { ok: false, resumen: r.error ?? "error" };
    const d = r.data as Record<string, unknown>;
    if (d && typeof d === "object") {
      if ("mensajes" in d) return { ok: true, resumen: `${(d.mensajes as unknown[]).length} mensajes` };
      if ("clasificacion" in d) return { ok: true, resumen: `clasificación: ${d.clasificacion}` };
      if ("accion" in d) return { ok: true, resumen: `acción: ${d.accion} ${d.id_contrato ?? ""}` };
      if ("ruta" in d) return { ok: true, resumen: `reporte: ${d.ruta}` };
      if ("contrato" in d) return { ok: true, resumen: `extraído (es_contrato=${d.es_contrato})` };
    }
    return { ok: true, resumen: "ok" };
  } catch {
    return { ok: false, resumen: "respuesta no parseable" };
  }
}

/** ¿El resultado de una tool indica que el agente debe pedir confirmación al humano? */
function requiereConfirmacion(raw: string): boolean {
  try {
    const r = JSON.parse(raw) as { ok: boolean; error?: string };
    return !r.ok && /requiere revisi[oó]n|requiere confirmaci[oó]n/i.test(r.error ?? "");
  } catch {
    return false;
  }
}

/**
 * Ejecuta un turno del agente. `emitir` recibe eventos en vivo (para SSE); puede ser no-op.
 */
export async function ejecutarTurno(
  llm: LlmAdapter,
  systemPrompt: string,
  historial: LlmMensaje[],
  ctx: ToolContext,
  emitir: (e: EventoAgente) => void = () => {},
): Promise<ResultadoTurno> {
  const defs = definicionesHerramientas();
  const mensajes: LlmMensaje[] = [{ rol: "system", contenido: systemPrompt }, ...historial];
  const toolCallsVisibles: ToolCallVisible[] = [];
  let tokens = 0;
  let needsConfirmation = false;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    emitir({ tipo: "pensando" });

    let resp;
    try {
      resp = await llm.enviar(mensajes, defs);
    } catch (e) {
      const msg = mensajeErrorLlm(e);
      emitir({ tipo: "error", texto: msg });
      return { reply: msg, toolCalls: toolCallsVisibles, needsConfirmation: false, tokens };
    }
    tokens += resp.tokens ?? 0;

    // Sin tool calls → respuesta final del turno
    if (resp.tool_calls.length === 0) {
      emitir({ tipo: "respuesta", texto: resp.texto });
      return { reply: resp.texto, toolCalls: toolCallsVisibles, needsConfirmation, tokens };
    }

    // Registrar el turno del asistente con sus tool calls
    mensajes.push({ rol: "assistant", contenido: resp.texto, tool_calls: resp.tool_calls });

    // Ejecutar cada tool call
    for (const tc of resp.tool_calls) {
      emitir({ tipo: "tool_call", toolCall: { nombre: tc.nombre, argumentos: tc.argumentos, resultado_resumen: "", ok: true } });
      const raw = await ejecutarHerramienta(tc.nombre, tc.argumentos, ctx);
      const { ok, resumen } = resumirResultado(raw);
      const visible: ToolCallVisible = { nombre: tc.nombre, argumentos: tc.argumentos, resultado_resumen: resumen, ok };
      toolCallsVisibles.push(visible);
      emitir({ tipo: "tool_result", toolCall: visible });

      if (requiereConfirmacion(raw)) needsConfirmation = true;

      // Alimentar el resultado de vuelta al modelo
      mensajes.push({ rol: "tool", contenido: raw, nombre_herramienta: tc.nombre, tool_call_id: tc.id });
    }
  }

  // Tope de iteraciones alcanzado (CA1)
  const aviso = "Alcancé el límite de pasos por turno. Esto es lo que logré hacer; dime si continúo.";
  emitir({ tipo: "respuesta", texto: aviso });
  appendJsonl(ctx.directory, "log.jsonl", {
    ts: new Date().toISOString(), herramienta: "ciclo", ok: false, resumen: "max_iteraciones",
  });
  return { reply: aviso, toolCalls: toolCallsVisibles, needsConfirmation, tokens };
}

function mensajeErrorLlm(e: unknown): string {
  const msg = (e as Error).message ?? String(e);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return "El proveedor del modelo está temporalmente sin cuota. Espera unos segundos e intenta de nuevo.";
  }
  if (/API key|API_KEY_INVALID|permission/i.test(msg)) {
    return "Hay un problema con la configuración del modelo en el servidor. Avisa al administrador.";
  }
  if (/timeout|ETIMEDOUT|ENOTFOUND|network/i.test(msg)) {
    return "No pude contactar al proveedor del modelo (tiempo de espera agotado). Intenta de nuevo.";
  }
  return "Ocurrió un error consultando el modelo. Intenta reformular tu mensaje.";
}
