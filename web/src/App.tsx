import { useEffect, useRef, useState } from "react";
import { enviarChat, type ToolCallVisible } from "./sse.js";

interface Mensaje {
  rol: "user" | "assistant";
  texto: string;
  toolCalls?: ToolCallVisible[];
  needsConfirmation?: boolean;
}

const SESSION_ID = `web-${Math.random().toString(36).slice(2, 10)}`;

const SUGERENCIAS = [
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.",
  "¿Qué mensajes hay pendientes en el buzón?",
  "Genera el reporte de alertas con fecha 2026-09-03.",
];

export function App() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [entrada, setEntrada] = useState("");
  const [pensando, setPensando] = useState(false);
  const [toolCallsEnVivo, setToolCallsEnVivo] = useState<ToolCallVisible[]>([]);
  const [salud, setSalud] = useState<{ llm_listo: boolean; model: string } | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setSalud).catch(() => setSalud(null));
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, toolCallsEnVivo, pensando]);

  async function enviar(texto: string) {
    if (!texto.trim() || pensando) return;
    setMensajes((m) => [...m, { rol: "user", texto }]);
    setEntrada("");
    setPensando(true);
    setToolCallsEnVivo([]);

    const acumuladas: ToolCallVisible[] = [];
    await enviarChat(SESSION_ID, texto, {
      onEvento: (e) => {
        if (e.tipo === "tool_result" && e.toolCall) {
          acumuladas.push(e.toolCall);
          setToolCallsEnVivo([...acumuladas]);
        }
      },
      onFin: (f) => {
        setMensajes((m) => [...m, {
          rol: "assistant",
          texto: f.reply,
          toolCalls: f.toolCalls,
          needsConfirmation: f.needsConfirmation,
        }]);
        setPensando(false);
        setToolCallsEnVivo([]);
      },
      onError: (msg) => {
        setMensajes((m) => [...m, { rol: "assistant", texto: `⚠️ ${msg}` }]);
        setPensando(false);
        setToolCallsEnVivo([]);
      },
    });
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Registro de Contratos</h1>
          <span className="subtitulo">Agente conversacional · Periferia IT</span>
        </div>
        <div className={`estado ${salud?.llm_listo ? "ok" : "warn"}`}>
          {salud === null ? "conectando…"
            : salud.llm_listo ? `modelo: ${salud.model}` : "modelo no configurado"}
        </div>
      </header>

      <main className="chat">
        {mensajes.length === 0 && (
          <div className="bienvenida">
            <p>Soy el asistente de registro de contratos. Puedo leer el buzón, extraer y clasificar
              cada contrato, registrarlo en el maestro y generar alertas de riesgo.</p>
            <div className="sugerencias">
              {SUGERENCIAS.map((s, i) => (
                <button key={i} className="sugerencia" onClick={() => enviar(s)} disabled={pensando}>
                  {s.length > 90 ? s.slice(0, 90) + "…" : s}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m, i) => (
          <Burbuja key={i} mensaje={m} />
        ))}

        {pensando && (
          <div className="burbuja asistente">
            <div className="pensando">El agente está trabajando<span className="puntos">…</span></div>
            {toolCallsEnVivo.map((tc, i) => <TarjetaTool key={i} tc={tc} />)}
          </div>
        )}
        <div ref={finRef} />
      </main>

      <footer className="entrada">
        <textarea
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(entrada); } }}
          placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter para salto de línea)"
          rows={2}
          disabled={pensando}
        />
        <button onClick={() => enviar(entrada)} disabled={pensando || !entrada.trim()}>
          Enviar
        </button>
      </footer>
    </div>
  );
}

function Burbuja({ mensaje }: { mensaje: Mensaje }) {
  return (
    <div className={`burbuja ${mensaje.rol === "user" ? "usuario" : "asistente"}`}>
      {mensaje.toolCalls && mensaje.toolCalls.length > 0 && (
        <div className="tool-calls">
          {mensaje.toolCalls.map((tc, i) => <TarjetaTool key={i} tc={tc} />)}
        </div>
      )}
      <div className="texto">{mensaje.texto}</div>
      {mensaje.needsConfirmation && (
        <div className="banner-confirmacion">
          ⏸ El agente espera tu confirmación. Responde para continuar (ej. "sí, confirmo").
        </div>
      )}
    </div>
  );
}

function TarjetaTool({ tc }: { tc: ToolCallVisible }) {
  return (
    <div className={`tarjeta-tool ${tc.ok ? "ok" : "fail"}`}>
      <div className="tool-nombre">
        <span className="icono">{tc.ok ? "🔧" : "⚠️"}</span> {tc.nombre}
      </div>
      <div className="tool-args">{JSON.stringify(tc.argumentos)}</div>
      <div className="tool-resultado">{tc.resultado_resumen}</div>
    </div>
  );
}
