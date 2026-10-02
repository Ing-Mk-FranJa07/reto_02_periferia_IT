/**
 * zod-schema.ts — Convierte el objeto `args` (mapa de esquemas zod) de una herramienta
 * a un JSON Schema simple que entienden las APIs de function calling.
 * Soporta los tipos que usan nuestras herramientas: string, boolean, any (object).
 */

import { z } from "zod";

type JsonSchema = Record<string, unknown> & {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
};

/** Describe un esquema zod individual como propiedad JSON Schema. */
function describirCampo(schema: z.ZodTypeAny): { prop: Record<string, unknown>; requerido: boolean } {
  let s = schema;
  let requerido = true;

  // Desenvolver optional / default
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault) {
    requerido = false;
    s = s._def.innerType as z.ZodTypeAny;
  }

  const description = (s._def as { description?: string }).description ?? schema._def?.description;

  if (s instanceof z.ZodString) {
    return { prop: { type: "string", description }, requerido };
  }
  if (s instanceof z.ZodBoolean) {
    return { prop: { type: "boolean", description }, requerido };
  }
  if (s instanceof z.ZodNumber) {
    return { prop: { type: "number", description }, requerido };
  }
  // z.any() u objetos complejos: lo representamos como objeto libre
  return { prop: { type: "object", description }, requerido };
}

/** Convierte un mapa { nombre: zodSchema } a JSON Schema de parámetros. */
export function argsAJsonSchema(args: Record<string, z.ZodTypeAny>): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [nombre, schema] of Object.entries(args)) {
    const { prop, requerido } = describirCampo(schema);
    properties[nombre] = prop;
    if (requerido) required.push(nombre);
  }
  return { type: "object", properties, required };
}
