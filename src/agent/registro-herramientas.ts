/**
 * registro-herramientas.ts — Puente entre las herramientas de dominio y el ciclo del agente.
 * Expone las definiciones (para el modelo) y un ejecutor por nombre `contratos_<export>`.
 */

import { z } from "zod";
import { HERRAMIENTAS } from "../tools/contratos.js";
import { argsAJsonSchema } from "../llm/zod-schema.js";
import type { LlmToolDef } from "../llm/adapter.js";
import type { ToolContext } from "../types.js";

const PREFIJO = "contratos";

type Herramienta = {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: any, ctx: ToolContext) => Promise<string>;
};

const MAPA: Record<string, Herramienta> = Object.fromEntries(
  Object.entries(HERRAMIENTAS).map(([nombre, h]) => [`${PREFIJO}_${nombre}`, h as Herramienta]),
);

/** Definiciones para el modelo (nombre completo contratos_<export>). */
export function definicionesHerramientas(): LlmToolDef[] {
  return Object.entries(MAPA).map(([nombreCompleto, h]) => ({
    nombre: nombreCompleto,
    descripcion: h.description,
    parametros: argsAJsonSchema(h.args),
  }));
}

/** Valida los argumentos con zod y ejecuta la herramienta. Nunca lanza. */
export async function ejecutarHerramienta(
  nombre: string,
  argumentos: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const h = MAPA[nombre];
  if (!h) return JSON.stringify({ ok: false, error: `Herramienta desconocida: ${nombre}` });

  // Validación zod de los argumentos antes de ejecutar
  const esquema = z.object(h.args as z.ZodRawShape);
  const parsed = esquema.safeParse(argumentos);
  if (!parsed.success) {
    const detalle = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return JSON.stringify({ ok: false, error: `Argumentos inválidos para ${nombre}: ${detalle}` });
  }
  return h.execute(parsed.data, ctx);
}
