/**
 * extraccion.ts — Extracción determinista de contratos desde texto (§7 del diseño).
 * Cada campo devuelve valor + confianza. Nunca inventa: campo ausente → null, confianza 0.
 */

import type { Contrato, CampoConf, Pais, Moneda } from "../types.js";
import { numeroEspanolAEntero } from "./numeros-es.js";

// Niveles de confianza (§7.4)
const CONF = {
  CANONICO: 0.95,
  DERIVADO_COMPLETO: 0.8,
  DERIVADO_INCOMPLETO: 0.55,
  VALOR_NO_COINCIDE: 0.5,
  AMBIGUO: 0.6,
  AUSENTE: 0.0,
} as const;

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

const sinAcentos = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function campo<T>(valor: T | null, confianza: number): CampoConf<T> {
  return { valor, confianza: valor === null ? CONF.AUSENTE : confianza };
}

/** §7.5 — ¿El documento es un contrato? Señales de estructura contractual. */
export function esContrato(texto: string): boolean {
  const t = sinAcentos(texto).toUpperCase();
  if (/COTIZACION|COT-\d/.test(t)) return false;
  const tienePartes = /CONTRATANTE/.test(t) && /CONTRATISTA/.test(t);
  const tieneObjeto = /OBJETO/.test(t);
  const esOtrosi = /OTROSI/.test(t);
  return (tienePartes && tieneObjeto) || esOtrosi;
}

/** ¿Es un otrosí? Captura también el id del contrato padre. */
export function detectarOtrosi(texto: string): { es_otrosi: boolean; id_padre: string | null } {
  const t = sinAcentos(texto).toUpperCase();
  if (!/OTROSI/.test(t)) return { es_otrosi: false, id_padre: null };
  // "OTROSÍ No. 1 AL CONTRATO ... No. CT-2026-011"
  const m = texto.match(/CONTRATO[^]*?N[o°º]\.?\s*([A-Z]{2}-\d{4}-\d+)/i);
  return { es_otrosi: true, id_padre: m ? m[1].toUpperCase() : null };
}

/** id_contrato: "No. CT-2026-015", "No. CM-2026-03". */
function extraerId(texto: string): CampoConf<string> {
  const m = texto.match(/N[o°º]\.?\s*([A-Z]{2}-\d{4}-\d+)/i);
  return campo(m ? m[1].toUpperCase() : null, CONF.CANONICO);
}

/** nit_cliente normalizado: sin puntos, guiones ni dígito de verificación. */
function extraerNit(texto: string): CampoConf<string> {
  // Primer identificador que aparece es el del CONTRATANTE (cliente)
  const m = texto.match(/(?:NIT|RUC|RTN)\s*([\d.\-]+)/i);
  if (!m) return campo<string>(null, CONF.AUSENTE);
  let raw = m[1].replace(/\./g, "").replace(/\s/g, "");
  // Quitar dígito de verificación tras guion (NIT colombiano)
  if (raw.includes("-")) raw = raw.split("-")[0];
  return campo(raw, CONF.CANONICO);
}

/** cliente: razón social antes de "identificada con" o del primer NIT/RUC. */
function extraerCliente(texto: string): CampoConf<string> {
  // "Entre ... , RAZÓN SOCIAL S.A.S., identificada con NIT ..."
  // "Entre RAZÓN SOCIAL S.A.S., NIT ..."
  const m = texto.match(/[Ee]ntre\s+(?:los suscritos,\s+)?([^,]+?(?:S\.A\.S\.|S\.A\.|S\. de R\.L\.|S\.A\.C\.))/);
  if (m) return campo(m[1].trim(), CONF.CANONICO);
  return campo<string>(null, CONF.AUSENTE);
}

/** País inferido del identificador (§6). Fallback: texto. */
function inferirPais(nit: string | null, texto: string): CampoConf<Pais> {
  const t = sinAcentos(texto).toLowerCase();
  if (nit) {
    const d = nit.replace(/\D/g, "");
    if (d.length === 13 && d.startsWith("17")) return campo<Pais>("EC", CONF.CANONICO);
    if (d.length === 11 && d.startsWith("20")) return campo<Pais>("PE", CONF.CANONICO);
    if (d.length === 14) return campo<Pais>("HN", CONF.CANONICO);
    if (d.length === 9) return campo<Pais>("CO", CONF.CANONICO);
    if (d.length === 6 || d.length === 7 || d.length === 8) return campo<Pais>("PA", CONF.AMBIGUO);
  }
  // Fallback por ciudad/país en texto
  if (/ecuador|quito|guayaquil/.test(t)) return campo<Pais>("EC", CONF.AMBIGUO);
  if (/per[uú]|lima/.test(t)) return campo<Pais>("PE", CONF.AMBIGUO);
  if (/panam[aá]/.test(t)) return campo<Pais>("PA", CONF.AMBIGUO);
  if (/honduras|tegucigalpa|san pedro sula/.test(t)) return campo<Pais>("HN", CONF.AMBIGUO);
  if (/colombia|bogot[aá]|medell[ií]n|barranquilla|cali/.test(t)) return campo<Pais>("CO", CONF.AMBIGUO);
  return campo<Pais>(null, CONF.AUSENTE);
}

/** moneda por código/símbolo o palabra. */
function extraerMoneda(texto: string): CampoConf<Moneda> {
  const t = texto.toUpperCase();
  if (/\bCOP\b|PESOS/.test(t)) return campo<Moneda>("COP", CONF.CANONICO);
  if (/\bUSD\b|D[OÓ]LARES/.test(t)) return campo<Moneda>("USD", CONF.CANONICO);
  if (/\bPEN\b|SOLES/.test(t)) return campo<Moneda>("PEN", CONF.CANONICO);
  if (/\bPAB\b|BALBOAS/.test(t)) return campo<Moneda>("PAB", CONF.CANONICO);
  if (/\bHNL\b|LEMPIRAS/.test(t)) return campo<Moneda>("HNL", CONF.CANONICO);
  return campo<Moneda>(null, CONF.AUSENTE);
}

/**
 * valor (§7.2): el dígito manda. Se extrae el número entre paréntesis/con código,
 * y se verifica contra las letras. Si no coinciden → baja confianza.
 */
function extraerValor(texto: string, indeterminado: boolean): CampoConf<number> {
  if (indeterminado) return campo<number>(0, CONF.AUSENTE);
  // Dígitos: "COP $265.000.000", "USD 120,000.00", "PEN 520,000.00"
  const mDig = texto.match(/(?:COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d.,]+)/i);
  let valorDig: number | null = null;
  if (mDig) valorDig = parsearMonto(mDig[1]);

  // Letras (verificación): texto antes de "(COP $...)" o "DE PESOS/DÓLARES/SOLES"
  const mLet = texto.match(/es de\s+(.+?)\s*(?:\(|M\/CTE|más|incluidos|,\s*IVA)/i);
  const valorLet = mLet ? numeroEspanolAEntero(mLet[1]) : null;

  if (valorDig !== null) {
    // Si tenemos letras y no cuadran (misma magnitud), bajar confianza
    if (valorLet !== null && !magnitudesCompatibles(valorDig, valorLet)) {
      return campo(valorDig, CONF.VALOR_NO_COINCIDE);
    }
    return campo(valorDig, CONF.CANONICO);
  }
  if (valorLet !== null) return campo(valorLet, CONF.DERIVADO_INCOMPLETO);
  return campo<number>(null, CONF.AUSENTE);
}

/** Parsea "265.000.000" o "120,000.00" o "520,000.00" a número entero de unidades. */
function parsearMonto(raw: string): number | null {
  let s = raw.trim();
  // Si tiene coma decimal con 2 dígitos al final tras comas de miles (formato US: 120,000.00)
  if (/,\d{3}/.test(s) && /\.\d{2}$/.test(s)) {
    s = s.replace(/,/g, "");
  } else if (/\.\d{3}/.test(s)) {
    // formato ES: 265.000.000 (punto = miles)
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** ¿Dos valores están en el mismo orden de magnitud (tolerancia relativa)? */
function magnitudesCompatibles(a: number, b: number): boolean {
  if (a === 0 || b === 0) return a === b;
  const r = a / b;
  return r > 0.95 && r < 1.05;
}

/** fecha "primero (1) de agosto de 2026" / "15 de agosto de 2026" → YYYY-MM-DD. */
function parsearFecha(frag: string): string | null {
  const t = sinAcentos(frag).toLowerCase();
  // "quince (15) de agosto de 2026" o "15 de agosto de 2026"
  const m = t.match(/(?:\((\d{1,2})\)|\b(\d{1,2}))\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
  if (!m) return null;
  const dia = Number.parseInt(m[1] ?? m[2], 10);
  const mes = MESES[m[3]];
  const anio = Number.parseInt(m[4], 10);
  if (!mes || !dia) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Suma meses a una fecha YYYY-MM-DD. */
function sumarMeses(fecha: string, meses: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCMonth(base.getUTCMonth() + meses);
  // El PRD usa fin de contrato inclusivo (ej. 12 meses → mismo día año siguiente menos 1 día)
  base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}

/** Extrae fecha_inicio y fecha_fin (§7.3). */
function extraerFechas(texto: string): { inicio: CampoConf<string>; fin: CampoConf<string> } {
  // Caso explícito: "desde el 15 de agosto de 2026 hasta el 14 de agosto de 2027"
  const mRango = texto.match(/desde\s+el\s+(.+?)\s+hasta\s+el\s+(.+?)[.\n]/i);
  if (mRango) {
    const ini = parsearFecha(mRango[1]);
    const fin = parsearFecha(mRango[2]);
    if (ini && fin) {
      return { inicio: campo(ini, CONF.CANONICO), fin: campo(fin, CONF.CANONICO) };
    }
  }

  // Otrosí que extiende el plazo: "se extiende hasta el primero (1) de noviembre de 2027"
  // (hay "hasta" pero no "desde": es una nueva fecha_fin para un contrato existente)
  const mHasta = texto.match(/(?:extiende|ampl[ií]a|prorroga|hasta el)\s+(?:hasta\s+el\s+)?([^."]+?\d{4})/i);
  if (mHasta) {
    const fin = parsearFecha(mHasta[1]);
    if (fin) {
      return { inicio: campo<string>(null, CONF.AUSENTE), fin: campo(fin, CONF.CANONICO) };
    }
  }

  // Fecha de firma (puede estar incompleta)
  const firmaCompleta = parsearFecha(texto.match(/[Ss]e firma[^]*$/)?.[0] ?? texto);
  const inicioCampo = firmaCompleta
    ? campo(firmaCompleta, CONF.DERIVADO_COMPLETO)
    : campo<string>(null, CONF.AUSENTE);

  // Plazo en meses: "de doce (12) meses"
  const mMeses = texto.match(/(?:de\s+)?(?:[a-zñáéíóú]+\s+)?\((\d{1,3})\)\s*meses|(\d{1,3})\s*meses/i);
  const meses = mMeses ? Number.parseInt(mMeses[1] ?? mMeses[2], 10) : null;

  if (meses && firmaCompleta) {
    return { inicio: inicioCampo, fin: campo(sumarMeses(firmaCompleta, meses), CONF.DERIVADO_COMPLETO) };
  }
  if (meses && !firmaCompleta) {
    // plazo en meses pero sin fecha de firma con día → baja confianza (msg-006)
    return { inicio: campo<string>(null, CONF.AUSENTE), fin: campo<string>(null, CONF.DERIVADO_INCOMPLETO) };
  }
  return { inicio: inicioCampo, fin: campo<string>(null, CONF.AUSENTE) };
}

/** póliza: requiere y tipos. */
function extraerPoliza(texto: string): { requiere: CampoConf<boolean>; tipos: CampoConf<string> } {
  const t = sinAcentos(texto).toLowerCase();
  const tieneGarantias = /garant[ií]as|p[oó]liza/.test(t);
  if (!tieneGarantias) return { requiere: campo(false, CONF.CANONICO), tipos: campo("", CONF.CANONICO) };
  const tipos: string[] = [];
  if (/cumplimiento/.test(t)) tipos.push("cumplimiento");
  if (/calidad/.test(t)) tipos.push("calidad");
  if (/salarios|prestaciones/.test(t)) tipos.push("salarios_prestaciones");
  if (/responsabilidad civil/.test(t)) tipos.push("responsabilidad_civil");
  return { requiere: campo(true, CONF.CANONICO), tipos: campo(tipos.join(";"), CONF.CANONICO) };
}

/** objeto: cláusula PRIMERA / OBJETO, recortado a 200 chars. */
function extraerObjeto(texto: string): CampoConf<string> {
  const m = texto.match(/OBJETO\.?\s*(.+?)(?:\n\n|SEGUNDA|PRIMERA\.)/is);
  if (!m) return campo<string>(null, CONF.AUSENTE);
  const limpio = m[1].replace(/\s+/g, " ").trim().slice(0, 200);
  return campo(limpio, CONF.CANONICO);
}

/** ¿Valor indeterminado? Contrato marco "sin valor determinado". */
function esIndeterminado(texto: string): boolean {
  return /no tiene un valor determinado|sin valor determinado|valor indeterminado/i.test(texto);
}

/**
 * Extrae un Contrato completo del texto. `comercialNombre` se resuelve fuera (desde el email).
 */
export function extraerContrato(texto: string, comercialNombre: string | null): Contrato {
  const { es_otrosi, id_padre } = detectarOtrosi(texto);
  const indeterminado = esIndeterminado(texto);
  const nit = extraerNit(texto);
  const fechas = extraerFechas(texto);
  const poliza = extraerPoliza(texto);
  const idCampo = es_otrosi
    ? campo(id_padre, id_padre ? CONF.CANONICO : CONF.AUSENTE)
    : extraerId(texto);

  const estado_poliza = poliza.requiere.valor ? "pendiente" : "no_aplica";

  return {
    id_contrato: idCampo,
    cliente: extraerCliente(texto),
    nit_cliente: nit,
    pais: inferirPais(nit.valor, texto),
    objeto: extraerObjeto(texto),
    valor: extraerValor(texto, indeterminado),
    valor_indeterminado: indeterminado,
    moneda: extraerMoneda(texto),
    fecha_inicio: fechas.inicio,
    fecha_fin: fechas.fin,
    requiere_poliza: poliza.requiere,
    tipo_poliza: poliza.tipos,
    estado_poliza,
    comercial: campo(comercialNombre, comercialNombre ? CONF.CANONICO : CONF.AUSENTE),
    es_otrosi,
    id_contrato_padre: id_padre,
  };
}

export const UMBRAL_REVISION = 0.8;
