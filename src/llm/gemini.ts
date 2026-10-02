/**
 * gemini.ts — Implementación de LlmAdapter para Google Gemini (@google/genai v1).
 * Lee la API key SOLO de variable de entorno. Nunca la expone en logs ni respuestas.
 */

import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import type { LlmAdapter, LlmMensaje, LlmToolDef, LlmRespuesta, LlmToolCall } from "./adapter.js";

export class GeminiAdapter implements LlmAdapter {
  readonly provider = "google";
  readonly model: string;
  private client: GoogleGenAI;

  constructor(apiKey: string, model = "gemini-2.5-flash") {
    if (!apiKey) throw new Error("Falta GOOGLE_API_KEY en el entorno del backend.");
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async enviar(mensajes: LlmMensaje[], herramientas: LlmToolDef[]): Promise<LlmRespuesta> {
    const systemInstruction = mensajes.find((m) => m.rol === "system")?.contenido;
    const contents = this.aContents(mensajes.filter((m) => m.rol !== "system"));
    const functionDeclarations = herramientas.map(this.aFunctionDeclaration);

    const resp = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
        temperature: 0.1,
      },
    });

    return this.aRespuesta(resp);
  }

  /** Convierte el historial propio a los `contents` de Gemini. */
  private aContents(mensajes: LlmMensaje[]): Content[] {
    const contents: Content[] = [];
    for (const m of mensajes) {
      if (m.rol === "user") {
        contents.push({ role: "user", parts: [{ text: m.contenido }] });
      } else if (m.rol === "assistant") {
        const parts: Part[] = [];
        if (m.contenido) parts.push({ text: m.contenido });
        for (const tc of m.tool_calls ?? []) {
          parts.push({ functionCall: { name: tc.nombre, args: tc.argumentos } });
        }
        contents.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });
      } else if (m.rol === "tool") {
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: m.nombre_herramienta ?? "tool",
              response: { resultado: m.contenido },
            },
          }],
        });
      }
    }
    return contents;
  }

  private aFunctionDeclaration(t: LlmToolDef): FunctionDeclaration {
    return {
      name: t.nombre,
      description: t.descripcion,
      parameters: t.parametros as FunctionDeclaration["parameters"],
    };
  }

  private aRespuesta(resp: unknown): LlmRespuesta {
    const r = resp as {
      text?: string;
      functionCalls?: { name?: string; args?: Record<string, unknown> }[];
      usageMetadata?: { totalTokenCount?: number };
    };
    const tool_calls: LlmToolCall[] = (r.functionCalls ?? []).map((fc, i) => ({
      id: `call_${i}_${fc.name ?? "tool"}`,
      nombre: fc.name ?? "tool",
      argumentos: fc.args ?? {},
    }));
    return {
      texto: r.text ?? "",
      tool_calls,
      tokens: r.usageMetadata?.totalTokenCount,
    };
  }
}
