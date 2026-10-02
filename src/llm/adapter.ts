/**
 * adapter.ts — Interfaz propia del proveedor LLM.
 * El ciclo del agente depende SOLO de esta interfaz, nunca del SDK concreto.
 * Cambiar de proveedor = nueva implementación de LlmAdapter, sin tocar el agente.
 */

/** Rol de un mensaje en la conversación con el modelo. */
export type Rol = "system" | "user" | "assistant" | "tool";

/** Una llamada a herramienta que el modelo decidió hacer. */
export interface LlmToolCall {
  id: string;
  nombre: string;
  argumentos: Record<string, unknown>;
}

/** Un mensaje del historial que se envía al modelo. */
export interface LlmMensaje {
  rol: Rol;
  contenido: string;
  /** Si rol === "assistant" y el modelo pidió herramientas. */
  tool_calls?: LlmToolCall[];
  /** Si rol === "tool": a qué tool_call responde. */
  tool_call_id?: string;
  nombre_herramienta?: string;
}

/** Definición de una herramienta que el modelo puede invocar. */
export interface LlmToolDef {
  nombre: string;
  descripcion: string;
  /** JSON Schema de los parámetros (derivado de zod). */
  parametros: Record<string, unknown>;
}

/** Respuesta del modelo tras un turno. */
export interface LlmRespuesta {
  /** Texto de la respuesta (puede ir vacío si solo pidió herramientas). */
  texto: string;
  /** Herramientas que el modelo quiere ejecutar. */
  tool_calls: LlmToolCall[];
  /** Tokens aproximados consumidos (para el tope de sesión). */
  tokens?: number;
}

/** Contrato del adaptador. Una sola función: enviar. */
export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  enviar(mensajes: LlmMensaje[], herramientas: LlmToolDef[]): Promise<LlmRespuesta>;
}
