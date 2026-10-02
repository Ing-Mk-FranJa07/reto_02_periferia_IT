/**
 * contratos.ts — Herramientas del agente (§5–§6.2 del PRD).
 * Cada export se expone al modelo como `contratos_<export>`.
 * Son la ÚNICA fuente de valores que el agente puede afirmar.
 * Toda herramienta devuelve string JSON { ok, data } | { ok:false, error }. Nunca lanza.
 */

import { z } from "zod";
import type {
  Correo, MensajeResumen, Contrato, Comercial, FilaMaestro, ToolContext,
} from "../types.js";
import {
  leerJson, leerTexto, listarMensajes, asegurarMaestro, leerMaestro, escribirMaestro,
  archivarContrato, appendJsonl, leerOutJson, escribirOutJson, escribirOutTexto, slug,
  FIXTURES_BASE, BUZON_DIR,
} from "../lib/io.js";
import { join } from "node:path";
import { extraerContrato, esContrato as docEsContrato } from "../lib/extraccion.js";
import { clasificar } from "../lib/clasificacion.js";

// ─────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────

const ok = (data: unknown) => JSON.stringify({ ok: true, data });
const fail = (error: string) => JSON.stringify({ ok: false, error });

function log(ctx: ToolContext, herramienta: string, mensajeId: string, okFlag: boolean, resumen: string): void {
  appendJsonl(ctx.directory, "log.jsonl", {
    ts: new Date().toISOString(), herramienta, mensaje_id: mensajeId, ok: okFlag, resumen,
  });
}

function cargarComerciales(dir: string): Comercial[] {
  return leerJson<Comercial[]>(dir, join(FIXTURES_BASE, "comerciales.json")) ?? [];
}

function resolverComercial(dir: string, email: string): { nombre: string | null; desconocido: boolean } {
  const c = cargarComerciales(dir).find((x) => x.email.toLowerCase() === email.toLowerCase());
  return { nombre: c?.nombre ?? null, desconocido: !c };
}

function adjuntoContrato(dir: string, mensajeId: string): string | null {
  const correo = leerJson<Correo>(dir, join(BUZON_DIR, mensajeId, "correo.json"));
  if (!correo) return null;
  // Un adjunto es "de contrato" si es contrato.txt u otrosi.txt
  return correo.adjuntos.find((a) => /contrato\.txt|otrosi\.txt/i.test(a)) ?? null;
}

/**
 * Normaliza el objeto `contrato` que llega como argumento. El modelo a veces lo anida como
 * { es_contrato, contrato: {...} } (la forma que devuelve contratos_extraer). Lo desenvolvemos
 * y validamos que tenga la forma mínima esperada (campos con {valor, confianza}).
 */
function normalizarContrato(entrada: unknown): Contrato | null {
  let c = entrada as Record<string, unknown> | null;
  if (c && typeof c === "object" && "contrato" in c && typeof (c as any).contrato === "object") {
    c = (c as any).contrato;
  }
  if (!c || typeof c !== "object") return null;
  const campo = (c as any).id_contrato;
  // Un Contrato válido tiene id_contrato como { valor, confianza }
  if (!campo || typeof campo !== "object" || !("confianza" in campo)) return null;
  return c as unknown as Contrato;
}

// ─────────────────────────────────────────────────────────────
// contratos_leer_buzon
// ─────────────────────────────────────────────────────────────

export const leer_buzon = {
  description:
    "Lista los mensajes del buzón que aún no se han procesado, indicando si cada uno trae un contrato adjunto.",
  args: {},
  async execute(_args: Record<string, never>, ctx: ToolContext): Promise<string> {
    try {
      const procesados = leerOutJson<string[]>(ctx.directory, "procesados.json", []);
      const mensajes: MensajeResumen[] = [];
      for (const id of listarMensajes(ctx.directory)) {
        if (procesados.includes(id)) continue;
        const correo = leerJson<Correo>(ctx.directory, join(BUZON_DIR, id, "correo.json"));
        if (!correo) continue;
        mensajes.push({
          id: correo.id,
          de: correo.de,
          asunto: correo.asunto,
          fecha: correo.fecha,
          adjuntos: correo.adjuntos,
          tiene_contrato: adjuntoContrato(ctx.directory, id) !== null,
        });
      }
      log(ctx, "contratos_leer_buzon", "", true, `${mensajes.length} mensajes pendientes`);
      return ok({ mensajes });
    } catch (e) {
      return fail(`No se pudo leer el buzón: ${(e as Error).message}`);
    }
  },
};

// ─────────────────────────────────────────────────────────────
// contratos_extraer
// ─────────────────────────────────────────────────────────────

export const extraer = {
  description:
    "Extrae los datos estructurados de un contrato (con nivel de confianza por campo) a partir del adjunto de un mensaje del buzón.",
  args: {
    mensaje_id: z.string().describe("Id del mensaje en fixtures/reto-02/buzon/ (ej. 'msg-001')"),
  },
  async execute(args: { mensaje_id: string }, ctx: ToolContext): Promise<string> {
    try {
      const correo = leerJson<Correo>(ctx.directory, join(BUZON_DIR, args.mensaje_id, "correo.json"));
      if (!correo) return fail(`El mensaje '${args.mensaje_id}' no existe en el buzón.`);

      const adjunto = adjuntoContrato(ctx.directory, args.mensaje_id);
      if (!adjunto) {
        // Puede ser una cotización u otro adjunto: devolvemos no-contrato explícito
        const otro = correo.adjuntos[0];
        const texto = otro ? leerTexto(ctx.directory, join(BUZON_DIR, args.mensaje_id, otro)) : null;
        log(ctx, "contratos_extraer", args.mensaje_id, true, "sin adjunto de contrato");
        return ok({ es_contrato: false, texto_detectado: texto ? texto.slice(0, 120) : null });
      }

      const texto = leerTexto(ctx.directory, join(BUZON_DIR, args.mensaje_id, adjunto));
      if (texto === null) return fail(`No se pudo leer el adjunto '${adjunto}'.`);
      if (texto.trim().length === 0) return fail("El adjunto del contrato está vacío.");

      const { nombre } = resolverComercial(ctx.directory, correo.de);
      const contrato = extraerContrato(texto, nombre);
      const es_contrato = docEsContrato(texto);

      log(ctx, "contratos_extraer", args.mensaje_id, true,
        `extraído ${contrato.id_contrato.valor ?? "sin id"} es_contrato=${es_contrato}`);
      return ok({ es_contrato, contrato, adjunto });
    } catch (e) {
      return fail(`Error extrayendo el contrato: ${(e as Error).message}`);
    }
  },
};

// ─────────────────────────────────────────────────────────────
// contratos_validar
// ─────────────────────────────────────────────────────────────

export const validar = {
  description:
    "Clasifica un contrato extraído como nuevo, actualización, duplicado o rechazado, y reporta los campos que requieren revisión humana.",
  args: {
    mensaje_id: z.string().describe("Id del mensaje asociado"),
    contrato: z.any().describe("Objeto Contrato devuelto por contratos_extraer"),
  },
  async execute(args: { mensaje_id: string; contrato: Contrato }, ctx: ToolContext): Promise<string> {
    try {
      const correo = leerJson<Correo>(ctx.directory, join(BUZON_DIR, args.mensaje_id, "correo.json"));
      if (!correo) return fail(`El mensaje '${args.mensaje_id}' no existe.`);

      const contrato = normalizarContrato(args.contrato);
      if (!contrato) return fail("El argumento 'contrato' no tiene la forma esperada; vuelve a llamar contratos_extraer para obtenerlo.");

      const adjunto = adjuntoContrato(ctx.directory, args.mensaje_id);
      const texto = adjunto ? leerTexto(ctx.directory, join(BUZON_DIR, args.mensaje_id, adjunto)) : null;
      const esContratoValido = texto !== null && docEsContrato(texto);

      const maestro = asegurarMaestro(ctx.directory);
      const { desconocido } = resolverComercial(ctx.directory, correo.de);
      const resultado = clasificar(contrato, maestro, esContratoValido, desconocido);

      log(ctx, "contratos_validar", args.mensaje_id, true,
        `${resultado.clasificacion} revision=[${resultado.requiere_revision.join(",")}]`);
      return ok(resultado);
    } catch (e) {
      return fail(`Error validando el contrato: ${(e as Error).message}`);
    }
  },
};

// ─────────────────────────────────────────────────────────────
// contratos_registrar
// ─────────────────────────────────────────────────────────────

export const registrar = {
  description:
    "Registra o actualiza el contrato en el maestro y archiva el documento. Solo escribe si no requiere revisión o si se confirma explícitamente con confirmado=true.",
  args: {
    mensaje_id: z.string().describe("Id del mensaje asociado"),
    contrato: z.any().describe("Objeto Contrato devuelto por contratos_extraer"),
    confirmado: z.boolean().optional().describe("true para forzar el registro de un contrato con campos en revisión"),
  },
  async execute(
    args: { mensaje_id: string; contrato: Contrato; confirmado?: boolean },
    ctx: ToolContext,
  ): Promise<string> {
    try {
      const correo = leerJson<Correo>(ctx.directory, join(BUZON_DIR, args.mensaje_id, "correo.json"));
      if (!correo) return fail(`El mensaje '${args.mensaje_id}' no existe.`);

      const contrato = normalizarContrato(args.contrato);
      if (!contrato) return fail("El argumento 'contrato' no tiene la forma esperada; vuelve a llamar contratos_extraer para obtenerlo.");

      const adjunto = adjuntoContrato(ctx.directory, args.mensaje_id);
      const texto = adjunto ? leerTexto(ctx.directory, join(BUZON_DIR, args.mensaje_id, adjunto)) : null;
      const esContratoValido = texto !== null && docEsContrato(texto);

      const maestro = asegurarMaestro(ctx.directory);
      const { nombre, desconocido } = resolverComercial(ctx.directory, correo.de);
      const resultado = clasificar(contrato, maestro, esContratoValido, desconocido);

      if (resultado.clasificacion === "rechazado") {
        log(ctx, "contratos_registrar", args.mensaje_id, false, "rechazado");
        return fail(`No se registra: ${resultado.motivo_rechazo}`);
      }
      if (resultado.clasificacion === "duplicado") {
        marcarProcesado(ctx, args.mensaje_id);
        log(ctx, "contratos_registrar", args.mensaje_id, true, "duplicado, sin escritura");
        return ok({ id_contrato: resultado.id_contrato_existente, accion: "duplicado", ruta_archivo: null });
      }
      if (resultado.requiere_revision.length > 0 && args.confirmado !== true) {
        log(ctx, "contratos_registrar", args.mensaje_id, false,
          `requiere revisión: ${resultado.requiere_revision.join(", ")}`);
        return fail(`requiere revisión: ${resultado.requiere_revision.join(", ")}`);
      }

      const c = contrato;
      const anioInicio =
        (c.fecha_inicio.valor ?? c.fecha_fin.valor ?? correo.fecha ?? "0000").slice(0, 4);
      const clienteSlug = slug(c.cliente.valor ?? "sin-cliente");
      const idFinal = c.id_contrato.valor ?? `AUTO-${anioInicio}-${maestro.length + 1}`;
      const ruta = adjunto
        ? archivarContrato(ctx.directory, args.mensaje_id, adjunto, anioInicio, clienteSlug, idFinal)
        : "";

      const fila = construirFila(c, idFinal, nombre, ruta, maestro);
      let accion: "nuevo" | "actualizacion";

      if (resultado.clasificacion === "actualizacion" && resultado.id_contrato_existente) {
        const idx = maestro.findIndex((f) => f.id_contrato === resultado.id_contrato_existente);
        const anterior = { ...maestro[idx] };
        maestro[idx] = { ...maestro[idx], ...filaActualizable(c, nombre, ruta) };
        accion = "actualizacion";
        appendJsonl(ctx.directory, join("sharepoint", "historial.jsonl"), {
          ts: new Date().toISOString(), id_contrato: resultado.id_contrato_existente,
          accion, cambios: resultado.diferencias ?? {}, mensaje_id: args.mensaje_id,
          valor_anterior: anterior.valor, valor_nuevo: maestro[idx].valor,
        });
      } else {
        maestro.push(fila);
        accion = "nuevo";
        appendJsonl(ctx.directory, join("sharepoint", "historial.jsonl"), {
          ts: new Date().toISOString(), id_contrato: idFinal, accion,
          cambios: {}, mensaje_id: args.mensaje_id,
        });
      }

      escribirMaestro(ctx.directory, maestro);
      marcarProcesado(ctx, args.mensaje_id);
      log(ctx, "contratos_registrar", args.mensaje_id, true, `${accion} ${idFinal}`);
      return ok({ id_contrato: idFinal, accion, ruta_archivo: ruta });
    } catch (e) {
      return fail(`Error registrando el contrato: ${(e as Error).message}`);
    }
  },
};

function construirFila(
  c: Contrato, idFinal: string, comercial: string | null, ruta: string, maestro: FilaMaestro[],
): FilaMaestro {
  return {
    id_contrato: idFinal,
    cliente: c.cliente.valor ?? "",
    nit_cliente: c.nit_cliente.valor ?? "",
    pais: c.pais.valor ?? "",
    objeto: c.objeto.valor ?? "",
    valor: String(c.valor.valor ?? 0),
    moneda: c.moneda.valor ?? "",
    fecha_inicio: c.fecha_inicio.valor ?? "",
    fecha_fin: c.fecha_fin.valor ?? "",
    requiere_poliza: String(c.requiere_poliza.valor ?? false),
    tipo_poliza: c.tipo_poliza.valor ?? "",
    estado_poliza: c.estado_poliza,
    comercial: comercial ?? "",
    ruta_sharepoint: ruta,
    fecha_registro: new Date().toISOString().slice(0, 10),
    fuente: "buzon",
  };
}

function filaActualizable(c: Contrato, comercial: string | null, ruta: string): Partial<FilaMaestro> {
  const parcial: Partial<FilaMaestro> = {};
  if (c.valor.valor !== null) parcial.valor = String(c.valor.valor);
  if (c.fecha_fin.valor) parcial.fecha_fin = c.fecha_fin.valor;
  if (c.fecha_inicio.valor) parcial.fecha_inicio = c.fecha_inicio.valor;
  if (ruta) parcial.ruta_sharepoint = ruta;
  return parcial;
}

function marcarProcesado(ctx: ToolContext, mensajeId: string): void {
  const procesados = leerOutJson<string[]>(ctx.directory, "procesados.json", []);
  if (!procesados.includes(mensajeId)) {
    procesados.push(mensajeId);
    escribirOutJson(ctx.directory, "procesados.json", procesados);
  }
}

// ─────────────────────────────────────────────────────────────
// contratos_alertas
// ─────────────────────────────────────────────────────────────

export const alertas = {
  description:
    "Genera el reporte de riesgos: contratos que vencen en ≤60 días, pólizas pendientes y contratos registrados desde el corte del 2026-05-30.",
  args: {
    hoy: z.string().describe("Fecha de referencia YYYY-MM-DD para que el reporte sea determinista"),
  },
  async execute(args: { hoy: string }, ctx: ToolContext): Promise<string> {
    try {
      const maestro = leerMaestro(ctx.directory);
      if (maestro.length === 0) asegurarMaestro(ctx.directory);
      const filas = leerMaestro(ctx.directory);
      const hoy = new Date(`${args.hoy}T00:00:00Z`);
      const en60 = new Date(hoy); en60.setUTCDate(en60.getUTCDate() + 60);
      const corte = new Date("2026-05-30T00:00:00Z");

      const vencen = filas.filter((f) => {
        if (!f.fecha_fin) return false;
        const ff = new Date(`${f.fecha_fin}T00:00:00Z`);
        return ff >= hoy && ff <= en60;
      });
      const polizas = filas.filter((f) => f.requiere_poliza === "true" && f.estado_poliza !== "vigente" && f.estado_poliza !== "no_aplica");
      const desdeCorte = filas.filter((f) => f.fecha_registro && new Date(`${f.fecha_registro}T00:00:00Z`) >= corte);

      const md = construirMarkdownAlertas(args.hoy, vencen, polizas, desdeCorte);
      escribirOutTexto(ctx.directory, "alertas.md", md);
      log(ctx, "contratos_alertas", "", true, `vencen=${vencen.length} polizas=${polizas.length}`);
      return ok({
        ruta: "out/alertas.md",
        vencen: vencen.map((f) => ({ id: f.id_contrato, cliente: f.cliente, fecha_fin: f.fecha_fin })),
        polizas_pendientes: polizas.map((f) => ({ id: f.id_contrato, cliente: f.cliente, estado: f.estado_poliza })),
        registrados_desde_corte: desdeCorte.map((f) => ({ id: f.id_contrato, cliente: f.cliente, fecha_registro: f.fecha_registro })),
      });
    } catch (e) {
      return fail(`Error generando alertas: ${(e as Error).message}`);
    }
  },
};

function construirMarkdownAlertas(
  hoy: string, vencen: FilaMaestro[], polizas: FilaMaestro[], desdeCorte: FilaMaestro[],
): string {
  const linea = (f: FilaMaestro) => `- ${f.id_contrato} — ${f.cliente}`;
  return [
    `# Reporte de alertas (referencia: ${hoy})`,
    ``,
    `## Contratos que vencen en ≤ 60 días`,
    vencen.length ? vencen.map((f) => `${linea(f)} (vence ${f.fecha_fin})`).join("\n") : "_Ninguno._",
    ``,
    `## Pólizas pendientes o no vigentes`,
    polizas.length ? polizas.map((f) => `${linea(f)} (estado: ${f.estado_poliza})`).join("\n") : "_Ninguna._",
    ``,
    `## Contratos registrados desde el corte (2026-05-30)`,
    desdeCorte.length ? desdeCorte.map((f) => `${linea(f)} (registrado ${f.fecha_registro})`).join("\n") : "_Ninguno._",
    ``,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────
// contratos_procesar_buzon  (lote completo en una sola llamada, sin LLM por paso)
// ─────────────────────────────────────────────────────────────

export const procesar_buzon = {
  description:
    "Procesa de una sola vez TODOS los mensajes pendientes del buzón: extrae, clasifica y registra lo que esté limpio, deja en revisión lo dudoso (sin registrarlo) y genera el reporte de alertas. Úsala cuando pidan 'procesa el buzón'.",
  args: {
    hoy: z.string().describe("Fecha de referencia YYYY-MM-DD para el reporte de alertas"),
  },
  async execute(args: { hoy: string }, ctx: ToolContext): Promise<string> {
    try {
      const procesados = leerOutJson<string[]>(ctx.directory, "procesados.json", []);
      const resumen: Array<Record<string, unknown>> = [];

      for (const id of listarMensajes(ctx.directory)) {
        if (procesados.includes(id)) continue;

        // 1. Extraer
        const extRaw = await extraer.execute({ mensaje_id: id }, ctx);
        const ext = JSON.parse(extRaw) as { ok: boolean; data?: any; error?: string };
        if (!ext.ok) { resumen.push({ mensaje_id: id, estado: "error", detalle: ext.error }); continue; }

        if (ext.data.es_contrato === false) {
          resumen.push({ mensaje_id: id, clasificacion: "rechazado", motivo: "no es un contrato", registrado: false });
          continue;
        }

        const contrato = ext.data.contrato as Contrato;

        // 2. Validar
        const valRaw = await validar.execute({ mensaje_id: id, contrato }, ctx);
        const val = JSON.parse(valRaw) as { ok: boolean; data?: any };
        const v = val.ok ? val.data : null;

        // 3. Registrar solo lo limpio (sin confirmar lo dudoso)
        const regRaw = await registrar.execute({ mensaje_id: id, contrato }, ctx);
        const reg = JSON.parse(regRaw) as { ok: boolean; data?: any; error?: string };

        resumen.push({
          mensaje_id: id,
          id_contrato: contrato.id_contrato.valor,
          cliente: contrato.cliente.valor,
          valor: contrato.valor.valor,
          moneda: contrato.moneda.valor,
          vigencia: `${contrato.fecha_inicio.valor ?? "—"} → ${contrato.fecha_fin.valor ?? "—"}`,
          clasificacion: v?.clasificacion ?? "desconocida",
          requiere_revision: v?.requiere_revision ?? [],
          remitente_desconocido: v?.remitente_desconocido ?? false,
          registrado: reg.ok,
          accion: reg.ok ? reg.data.accion : null,
          nota: reg.ok ? null : reg.error,
        });
      }

      // 4. Alertas
      const alRaw = await alertas.execute({ hoy: args.hoy }, ctx);
      const al = JSON.parse(alRaw) as { ok: boolean; data?: any };

      log(ctx, "contratos_procesar_buzon", "", true, `${resumen.length} mensajes procesados`);
      return ok({ contratos: resumen, alertas: al.ok ? al.data : null });
    } catch (e) {
      return fail(`Error procesando el buzón: ${(e as Error).message}`);
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Registro de todas las herramientas (para el ciclo del agente y demo)
// ─────────────────────────────────────────────────────────────

export const HERRAMIENTAS = { leer_buzon, extraer, validar, registrar, alertas, procesar_buzon } as const;
