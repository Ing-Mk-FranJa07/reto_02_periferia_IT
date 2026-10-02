/**
 * numeros-es.ts — Conversor de números escritos en español a entero.
 * Se usa SOLO como verificación secundaria del valor; el dígito manda (ver §7.2 del diseño).
 */

const UNIDADES: Record<string, number> = {
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30,
  cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};

const CENTENAS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400,
  quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Convierte un bloque < 1000 (ej. "doscientos sesenta y cinco"). */
function parseBloque(palabras: string[]): number {
  let total = 0;
  for (const p of palabras) {
    if (p === "y") continue;
    if (CENTENAS[p] !== undefined) total += CENTENAS[p];
    else if (UNIDADES[p] !== undefined) total += UNIDADES[p];
  }
  return total;
}

/**
 * Convierte una frase numérica en español a entero.
 * Soporta millones y miles. Devuelve null si no reconoce nada.
 * Ej: "doscientos sesenta y cinco millones" → 265000000
 */
export function numeroEspanolAEntero(frase: string): number | null {
  const palabras = normalizar(frase).split(" ").filter(Boolean);
  if (palabras.length === 0) return null;

  let total = 0;
  let bloqueActual: string[] = [];
  let reconocioAlgo = false;

  for (const p of palabras) {
    if (p === "millon" || p === "millones") {
      const b = bloqueActual.length ? parseBloque(bloqueActual) : 1;
      total += b * 1_000_000;
      bloqueActual = [];
      reconocioAlgo = true;
    } else if (p === "mil") {
      const b = bloqueActual.length ? parseBloque(bloqueActual) : 1;
      total += b * 1_000;
      bloqueActual = [];
      reconocioAlgo = true;
    } else if (CENTENAS[p] !== undefined || UNIDADES[p] !== undefined || p === "y") {
      bloqueActual.push(p);
      if (p !== "y") reconocioAlgo = true;
    }
  }
  total += parseBloque(bloqueActual);
  return reconocioAlgo ? total : null;
}
