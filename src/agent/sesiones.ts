/**
 * sesiones.ts — Memoria de conversación en memoria (sin base de datos).
 * Una sesión = historial de mensajes + contador de tokens para el tope por sesión.
 */

import type { LlmMensaje } from "../llm/adapter.js";

export interface Sesion {
  id: string;
  historial: LlmMensaje[];
  tokens: number;
  creada: string;
}

const MAX_TOKENS_SESION = Number(process.env.MAX_TOKENS_SESION ?? 120_000);
const sesiones = new Map<string, Sesion>();

export function obtenerSesion(id: string): Sesion {
  let s = sesiones.get(id);
  if (!s) {
    s = { id, historial: [], tokens: 0, creada: new Date().toISOString() };
    sesiones.set(id, s);
  }
  return s;
}

export function agregarMensaje(id: string, mensaje: LlmMensaje): void {
  obtenerSesion(id).historial.push(mensaje);
}

export function sumarTokens(id: string, tokens: number): void {
  obtenerSesion(id).tokens += tokens;
}

export function excedioTope(id: string): boolean {
  return obtenerSesion(id).tokens >= MAX_TOKENS_SESION;
}

export function limpiarSesion(id: string): void {
  sesiones.delete(id);
}
