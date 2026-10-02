/**
 * demo.ts — Verificación de las herramientas SIN modelo (§6.6 del PRD).
 * Procesa los 6 mensajes del buzón llamando directo a las herramientas.
 * Imprime por mensaje: clasificación, campos en revisión y acción tomada.
 * Los mensajes con requiere_revision no vacío NO se registran en la primera pasada;
 * luego se muestra una segunda llamada con confirmado:true para msg-006.
 *
 * Corre sin clave de ningún proveedor:  npm run demo
 */

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { HERRAMIENTAS } from "./src/tools/contratos.js";
import { limpiarOut } from "./src/lib/io.js";
import type { ToolContext } from "./src/types.js";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ctx: ToolContext = { directory: DIRECTORY, sessionId: "demo" };

type ParsedResult = { ok: true; data: any } | { ok: false; error: string };
const parse = (s: string): ParsedResult => JSON.parse(s);

function titulo(t: string): void {
  console.log("\n" + "=".repeat(70) + `\n${t}\n` + "=".repeat(70));
}

async function procesarMensaje(id: string, confirmar = false): Promise<void> {
  console.log(`\n──── ${id}${confirmar ? " (segunda pasada, confirmado:true)" : ""} ────`);

  // 1. Extraer
  const extRaw = await HERRAMIENTAS.extraer.execute({ mensaje_id: id }, ctx);
  const ext = parse(extRaw);
  if (!ext.ok) { console.log(`  extraer → ERROR: ${ext.error}`); return; }

  if (ext.data.es_contrato === false) {
    // Validar igual para obtener la clasificación "rechazado"
    const valRaw = await HERRAMIENTAS.validar.execute({ mensaje_id: id, contrato: ext.data.contrato ?? {} }, ctx);
    const val = parse(valRaw);
    const clasif = val.ok ? val.data.clasificacion : "rechazado";
    console.log(`  clasificación : ${clasif}`);
    console.log(`  acción        : no se registra (no es contrato)`);
    return;
  }

  const contrato = ext.data.contrato;
  console.log(`  id_contrato   : ${contrato.id_contrato.valor ?? "—"}`);
  console.log(`  cliente       : ${contrato.cliente.valor ?? "—"}`);
  console.log(`  valor         : ${contrato.valor.valor ?? "—"} ${contrato.moneda.valor ?? ""}` +
    `${contrato.valor_indeterminado ? " (indeterminado)" : ""}`);
  console.log(`  vigencia      : ${contrato.fecha_inicio.valor ?? "—"} → ${contrato.fecha_fin.valor ?? "—"}`);
  console.log(`  póliza        : ${contrato.requiere_poliza.valor ? contrato.tipo_poliza.valor : "no aplica"}`);

  // 2. Validar
  const valRaw = await HERRAMIENTAS.validar.execute({ mensaje_id: id, contrato }, ctx);
  const val = parse(valRaw);
  if (!val.ok) { console.log(`  validar → ERROR: ${val.error}`); return; }
  console.log(`  clasificación : ${val.data.clasificacion}`);
  if (val.data.remitente_desconocido) console.log(`  remitente     : DESCONOCIDO (se reporta, no bloquea)`);
  if (val.data.requiere_revision.length) console.log(`  revisión      : ${val.data.requiere_revision.join(", ")}`);
  if (val.data.diferencias && Object.keys(val.data.diferencias).length)
    console.log(`  diferencias   : ${JSON.stringify(val.data.diferencias)}`);

  // 3. Registrar
  const regRaw = await HERRAMIENTAS.registrar.execute(
    { mensaje_id: id, contrato, confirmado: confirmar }, ctx);
  const reg = parse(regRaw);
  if (reg.ok) {
    console.log(`  acción        : ${reg.data.accion}` +
      (reg.data.id_contrato ? ` (${reg.data.id_contrato})` : "") +
      (reg.data.ruta_archivo ? ` → ${reg.data.ruta_archivo}` : ""));
  } else {
    console.log(`  acción        : NO registrado — ${reg.error}`);
  }
}

async function main(): Promise<void> {
  titulo("DEMO Reto 02 — Registro de Contratos (sin modelo)");
  limpiarOut(ctx.directory); // determinismo: out/ limpio al inicio

  // Leer buzón
  const buzonRaw = await HERRAMIENTAS.leer_buzon.execute({}, ctx);
  const buzon = parse(buzonRaw);
  if (!buzon.ok) { console.log(`leer_buzon → ERROR: ${buzon.error}`); process.exit(1); }
  console.log(`\nMensajes en el buzón: ${buzon.data.mensajes.length}`);
  for (const m of buzon.data.mensajes) {
    console.log(`  · ${m.id} — ${m.asunto} ${m.tiene_contrato ? "" : "(sin contrato)"}`);
  }

  // Primera pasada: procesar los 6
  titulo("PRIMERA PASADA — registrar lo limpio, detener lo dudoso");
  for (const m of buzon.data.mensajes) {
    await procesarMensaje(m.id);
  }

  // Segunda pasada: confirmar msg-006 (baja confianza en valor y fecha_fin)
  titulo("SEGUNDA PASADA — confirmación humana de msg-006");
  await procesarMensaje("msg-006", true);

  // Alertas con fecha de referencia determinista
  titulo("REPORTE DE ALERTAS (hoy = 2026-09-03)");
  const alRaw = await HERRAMIENTAS.alertas.execute({ hoy: "2026-09-03" }, ctx);
  const al = parse(alRaw);
  if (al.ok) {
    console.log(`  vencen ≤60d       : ${al.data.vencen.map((v: any) => v.id).join(", ") || "ninguno"}`);
    console.log(`  pólizas pendientes: ${al.data.polizas_pendientes.map((v: any) => v.id).join(", ") || "ninguna"}`);
    console.log(`  desde el corte    : ${al.data.registrados_desde_corte.length} contratos`);
    console.log(`  reporte en        : ${al.data.ruta}`);
  } else {
    console.log(`  alertas → ERROR: ${al.error}`);
  }

  titulo("DEMO COMPLETADA");
}

main().catch((e) => { console.error("Error fatal en demo:", e); process.exit(1); });
