/**
 * clasificacion.ts — Clasifica un contrato contra el maestro (§8 del diseño).
 * Precedencia: ¿es contrato? → ¿otrosí? → match por id → fallback NIT+objeto.
 */

import type { Contrato, FilaMaestro, ResultadoValidacion } from "../types.js";
import { UMBRAL_REVISION } from "./extraccion.js";

const sinAcentos = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Similitud simple por tokens compartidos (Jaccard sobre palabras). */
function similitud(a: string, b: string): number {
  const ta = new Set(sinAcentos(a).split(/\s+/).filter(Boolean));
  const tb = new Set(sinAcentos(b).split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Campos con confianza < umbral → requieren revisión. */
function camposEnRevision(contrato: Contrato): string[] {
  const campos: [string, { confianza: number }][] = [
    ["id_contrato", contrato.id_contrato],
    ["cliente", contrato.cliente],
    ["nit_cliente", contrato.nit_cliente],
    ["pais", contrato.pais],
    ["objeto", contrato.objeto],
    ["valor", contrato.valor],
    ["moneda", contrato.moneda],
    ["fecha_inicio", contrato.fecha_inicio],
    ["fecha_fin", contrato.fecha_fin],
  ];
  return campos.filter(([, c]) => c.confianza < UMBRAL_REVISION).map(([k]) => k);
}

/** Diferencias entre el contrato extraído y la fila existente del maestro. */
function calcularDiferencias(
  contrato: Contrato,
  fila: FilaMaestro,
): Record<string, { antes: string; despues: string }> {
  const diffs: Record<string, { antes: string; despues: string }> = {};
  const comparar = (campo: string, antes: string, despues: string | null) => {
    if (despues !== null && String(despues) !== String(antes)) {
      diffs[campo] = { antes, despues: String(despues) };
    }
  };
  comparar("valor", fila.valor, contrato.valor.valor !== null ? String(contrato.valor.valor) : null);
  comparar("fecha_fin", fila.fecha_fin, contrato.fecha_fin.valor);
  comparar("fecha_inicio", fila.fecha_inicio, contrato.fecha_inicio.valor);
  return diffs;
}

/**
 * Clasifica el contrato. `esContratoValido` lo determina el extractor (§7.5).
 */
export function clasificar(
  contrato: Contrato,
  maestro: FilaMaestro[],
  esContratoValido: boolean,
  remitenteDesconocido: boolean,
): ResultadoValidacion {
  // 1. ¿Es contrato?
  if (!esContratoValido) {
    return {
      clasificacion: "rechazado",
      requiere_revision: [],
      motivo_rechazo: "El documento no es un contrato (sin partes ni objeto identificables).",
    };
  }

  const revision = camposEnRevision(contrato);

  // 2. ¿Es otrosí? → actualización del contrato padre
  if (contrato.es_otrosi && contrato.id_contrato_padre) {
    const existente = maestro.find((f) => f.id_contrato === contrato.id_contrato_padre);
    if (existente) {
      return {
        clasificacion: "actualizacion",
        id_contrato_existente: existente.id_contrato,
        requiere_revision: revision,
        diferencias: calcularDiferencias(contrato, existente),
        remitente_desconocido: remitenteDesconocido,
      };
    }
  }

  // 3. Match por id_contrato (manda)
  const id = contrato.id_contrato.valor;
  if (id) {
    const existente = maestro.find((f) => f.id_contrato === id);
    if (existente) {
      const mismoValor = String(contrato.valor.valor ?? "") === existente.valor;
      const mismoInicio = contrato.fecha_inicio.valor === existente.fecha_inicio;
      const mismoFin = contrato.fecha_fin.valor === existente.fecha_fin;
      if (mismoValor && mismoInicio && mismoFin) {
        return {
          clasificacion: "duplicado",
          id_contrato_existente: existente.id_contrato,
          requiere_revision: [],
          remitente_desconocido: remitenteDesconocido,
        };
      }
      return {
        clasificacion: "actualizacion",
        id_contrato_existente: existente.id_contrato,
        requiere_revision: revision,
        diferencias: calcularDiferencias(contrato, existente),
        remitente_desconocido: remitenteDesconocido,
      };
    }
    // id no existe → nuevo
    return { clasificacion: "nuevo", requiere_revision: revision, remitente_desconocido: remitenteDesconocido };
  }

  // 4. Fallback: sin id, similitud NIT + objeto ≥ 0.9
  if (contrato.nit_cliente.valor && contrato.objeto.valor) {
    const candidato = maestro.find(
      (f) =>
        f.nit_cliente === contrato.nit_cliente.valor &&
        similitud(f.objeto, contrato.objeto.valor!) >= 0.9,
    );
    if (candidato) {
      return {
        clasificacion: "actualizacion",
        id_contrato_existente: candidato.id_contrato,
        requiere_revision: revision,
        diferencias: calcularDiferencias(contrato, candidato),
        remitente_desconocido: remitenteDesconocido,
      };
    }
  }

  return { clasificacion: "nuevo", requiere_revision: revision, remitente_desconocido: remitenteDesconocido };
}
