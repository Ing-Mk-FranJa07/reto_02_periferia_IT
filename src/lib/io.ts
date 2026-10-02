/**
 * io.ts — Acceso al sistema de archivos: fixtures (lectura), out/ (escritura).
 * Todas las rutas se resuelven desde ctx.directory (raíz del proyecto), nunca absolutas.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, appendFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import Papa from "papaparse";
import type { FilaMaestro } from "../types.js";

export const FIXTURES_BASE = join("fixtures", "reto-02");
export const BUZON_DIR = join(FIXTURES_BASE, "buzon");
export const OUT_DIR = "out";
export const SHAREPOINT_DIR = join(OUT_DIR, "sharepoint");
export const MAESTRO_OUT = join(SHAREPOINT_DIR, "maestro-contratos.csv");

/** Lee un archivo de texto si existe; null si no. */
export function leerTexto(dir: string, rel: string): string | null {
  const p = join(dir, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

/** Lee y parsea un JSON si existe; null si no. */
export function leerJson<T>(dir: string, rel: string): T | null {
  const txt = leerTexto(dir, rel);
  if (txt === null) return null;
  return JSON.parse(txt) as T;
}

/** Lista los subdirectorios del buzón (cada uno es un mensaje). */
export function listarMensajes(dir: string): string[] {
  const base = join(dir, BUZON_DIR);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Asegura que el maestro de out/ exista; en la primera ejecución copia el fixture (RN6). */
export function asegurarMaestro(dir: string): FilaMaestro[] {
  const destino = join(dir, MAESTRO_OUT);
  if (!existsSync(destino)) {
    const fuente = join(dir, FIXTURES_BASE, "maestro-contratos.csv");
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(fuente, destino);
  }
  return leerMaestro(dir);
}

/** Lee el maestro de out/ como filas tipadas. */
export function leerMaestro(dir: string): FilaMaestro[] {
  const p = join(dir, MAESTRO_OUT);
  if (!existsSync(p)) return [];
  const csv = readFileSync(p, "utf8");
  const parsed = Papa.parse<FilaMaestro>(csv, { header: true, skipEmptyLines: true });
  return parsed.data;
}

/** Escribe el maestro completo de vuelta a out/ (preservando el orden de columnas). */
export function escribirMaestro(dir: string, filas: FilaMaestro[]): void {
  const columnas: (keyof FilaMaestro)[] = [
    "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda",
    "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza", "estado_poliza",
    "comercial", "ruta_sharepoint", "fecha_registro", "fuente",
  ];
  const csv = Papa.unparse({ fields: columnas as string[], data: filas }, { newline: "\n" });
  const destino = join(dir, MAESTRO_OUT);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, csv + "\n", "utf8");
}

/** Copia el archivo de un contrato a la estructura tipo SharePoint y devuelve la ruta relativa. */
export function archivarContrato(
  dir: string,
  mensajeId: string,
  nombreAdjunto: string,
  anioInicio: string,
  clienteSlug: string,
  idContrato: string,
): string {
  const ext = nombreAdjunto.includes(".") ? nombreAdjunto.split(".").pop()! : "txt";
  const relDestino = join("Contratos", anioInicio, clienteSlug, `${idContrato}.${ext}`);
  const absDestino = join(dir, SHAREPOINT_DIR, relDestino);
  mkdirSync(dirname(absDestino), { recursive: true });
  const fuente = join(dir, BUZON_DIR, mensajeId, nombreAdjunto);
  if (existsSync(fuente)) copyFileSync(fuente, absDestino);
  return join("sharepoint", relDestino).replace(/\\/g, "/");
}

/** Agrega una línea a un archivo .jsonl en out/, creándolo si no existe. */
export function appendJsonl(dir: string, rel: string, obj: unknown): void {
  const p = join(dir, OUT_DIR, rel);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(obj) + "\n", "utf8");
}

/** Lee un archivo JSON de out/ (ej. procesados.json). */
export function leerOutJson<T>(dir: string, rel: string, fallback: T): T {
  const p = join(dir, OUT_DIR, rel);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

/** Escribe un archivo JSON en out/. */
export function escribirOutJson(dir: string, rel: string, obj: unknown): void {
  const p = join(dir, OUT_DIR, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

/** Escribe un archivo de texto en out/. */
export function escribirOutTexto(dir: string, rel: string, contenido: string): void {
  const p = join(dir, OUT_DIR, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, contenido, "utf8");
}

/** Limpia out/ al inicio (para determinismo del demo). */
export function limpiarOut(dir: string): void {
  const p = join(dir, OUT_DIR);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

/** Convierte un nombre de cliente en slug para rutas. */
export function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
