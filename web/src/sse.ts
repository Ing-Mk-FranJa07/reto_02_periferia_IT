/**
 * sse.ts — Cliente del endpoint /api/chat con streaming SSE.
 * Parsea los eventos del backend (pensando, tool_call, tool_result, respuesta, fin, error).
 */

export interface ToolCallVisible {
  nombre: string;
  argumentos: Record<string, unknown>;
  resultado_resumen: string;
  ok: boolean;
}

export interface EventoAgente {
  tipo: "pensando" | "tool_call" | "tool_result" | "respuesta" | "confirmacion" | "error";
  texto?: string;
  toolCall?: ToolCallVisible;
}

export interface EventoFin {
  reply: string;
  toolCalls: ToolCallVisible[];
  needsConfirmation: boolean;
}

export interface Handlers {
  onEvento: (e: EventoAgente) => void;
  onFin: (f: EventoFin) => void;
  onError: (mensaje: string) => void;
}

/** Envía un mensaje y procesa el stream SSE de respuesta. */
export async function enviarChat(sessionId: string, message: string, h: Handlers): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message }),
    });
  } catch {
    h.onError("No pude conectar con el servidor.");
    return;
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Error del servidor." }));
    h.onError(err.error ?? `Error ${resp.status}`);
    return;
  }
  if (!resp.body) {
    h.onError("Respuesta sin cuerpo del servidor.");
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Los eventos SSE se separan por doble salto de línea
    const bloques = buffer.split("\n\n");
    buffer = bloques.pop() ?? "";
    for (const bloque of bloques) {
      procesarBloque(bloque, h);
    }
  }
}

function procesarBloque(bloque: string, h: Handlers): void {
  let evento = "message";
  let data = "";
  for (const linea of bloque.split("\n")) {
    if (linea.startsWith("event:")) evento = linea.slice(6).trim();
    else if (linea.startsWith("data:")) data += linea.slice(5).trim();
  }
  if (!data) return;

  try {
    const payload = JSON.parse(data);
    if (evento === "fin") {
      h.onFin(payload as EventoFin);
    } else {
      h.onEvento({ tipo: evento as EventoAgente["tipo"], ...payload });
    }
  } catch {
    // bloque incompleto; se ignora
  }
}
