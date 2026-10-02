# Reto 02 — Agente conversacional "Registro de Contratos Vigentes"

Agente que actúa como punto único de recepción de contratos: lee un buzón, extrae los datos de cada
contrato con nivel de confianza por campo, los clasifica (nuevo / actualización / duplicado /
rechazado), los registra en el maestro, archiva el documento y genera alertas de riesgo. Pide
confirmación humana antes de registrar lo dudoso.

- **Backend:** Node 20+ · TypeScript · Hono · ciclo de agente con herramientas tipadas (zod)
- **Front:** React + Vite (chat con tool calls visibles y banner de confirmación)
- **LLM:** Google Gemini 2.5 Flash (detrás de un adaptador intercambiable)

---

## Requisitos

- Node.js 20 o superior (`node --version`)
- Una API key de Google Gemini — se obtiene gratis en https://aistudio.google.com/apikey

## Puesta en marcha (local)

```bash
# 1. Instalar dependencias del backend y del front
npm install
npm --prefix web install

# 2. Configurar la clave del modelo
cp .env.example .env
#   edita .env y pon tu GOOGLE_API_KEY

# 3a. Desarrollo (dos procesos): backend + front con recarga
npm run dev            # backend en http://localhost:8000
npm run web:dev        # front en  http://localhost:5173 (proxia /api al backend)

# 3b. O un solo comando que compila el front y lo sirve desde el backend
npm run build
npm start              # todo en http://localhost:8000
```

Abrir **http://localhost:5173** (modo dev) o **http://localhost:8000** (modo build).

## Verificación sin modelo (`demo.ts`)

Procesa los 6 mensajes del buzón llamando directo a las herramientas, sin consumir el LLM ni
necesitar API key. Muestra la clasificación, los campos en revisión y la acción por cada mensaje,
incluida la confirmación humana de `msg-006`:

```bash
npm run demo
```

## Variables de entorno

| Variable | Descripción | Por defecto |
|---|---|---|
| `GOOGLE_API_KEY` | Clave de Gemini (solo backend, nunca en el front ni en logs) | — (obligatoria para el chat) |
| `GEMINI_MODEL` | Modelo a usar | `gemini-2.5-flash` |
| `PORT` | Puerto del servidor | `8000` |
| `MAX_ITERACIONES` | Tope de pasos herramienta→modelo por turno | `25` |
| `MAX_TOKENS_SESION` | Tope de tokens por sesión | `120000` |

La clave vive solo en el entorno del backend. El endpoint `/api/health` reporta si el modelo está
configurado sin exponer la clave.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → stream SSE de eventos + evento `fin` con `{ reply, toolCalls, needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial de la sesión |
| `POST` | `/api/sessions/:id/limpiar` | Reinicia la sesión |
| `GET` | `/api/health` | `{ ok, provider, model, llm_listo }` sin exponer la clave |

## Estructura

```
reto-02/
├── agent/prompt.md                 # system prompt (comportamiento)
├── src/
│   ├── server.ts                   # API Hono + ciclo del agente
│   ├── agent/                      # ciclo, sesiones, registro de herramientas
│   ├── llm/                        # adapter.ts (interfaz) + gemini.ts (implementación)
│   ├── tools/contratos.ts          # 5 herramientas tipadas (zod) — única fuente de valores
│   ├── knowledge/registro-contratos.md   # conocimiento del proceso
│   └── lib/                        # extracción, clasificación, IO, números-es
├── web/                            # front React + Vite
├── fixtures/reto-02/               # entregados por Periferia (no modificar)
├── out/                            # generado en ejecución (ignorado por git)
├── demo.ts                         # verificación sin modelo
├── .env.example
├── SOLUCION.md
└── README.md
```

## Prompt de ejemplo (demo en vivo)

En una sesión nueva del chat:

```
Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio,
muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas.
No registres nada dudoso sin preguntarme.
```

Luego, para confirmar `msg-006`:

```
confirmo el valor 0 y la fecha fin 2027-08-31
```

## Link de prueba

**https://reto-02-periferia-it.onrender.com/**

Desplegado en Render (plan free). Nota: el servicio se suspende tras ~15 min de inactividad; la
primera visita tras ese tiempo tarda ~30–50 s en despertar. Para la defensa, abrir el link unos
minutos antes.
