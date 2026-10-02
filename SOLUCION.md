# SOLUCIÓN — Reto 02 "Registro de Contratos Vigentes"

> Candidato: Francisco Javier González López · Proceso de selección Perxia 2.0 · Periferia IT

---

## 1. Problema en una frase

El registro maestro de contratos de Periferia está congelado desde el 2026-05-30 porque dependía de
una persona que ya no está; **le duele a la dirección** (no puede responder qué contratos vencen ni
qué pólizas faltan) y a la **analista administrativa** (no tiene punto único de recepción ni un
proceso que sobreviva a la rotación).

## 2. Arquitectura

```
┌─────────────────────────┐   HTTP + SSE   ┌──────────────────────────────────────┐
│  Front React (web/)      │ ─────────────▶ │  Backend Node + Hono (src/)           │
│  - historial de chat     │ ◀───────────── │  - server.ts: API + ciclo del agente  │
│  - tarjeta por tool call │                │  - agent/ciclo.ts: bucle con tope     │
│  - banner de confirmación│                │  - llm/adapter.ts + llm/gemini.ts     │
└─────────────────────────┘                │  - tools/contratos.ts (zod)           │
                                           └───────┬──────────────────┬────────────┘
                                                   │                  │
                                          fixtures/ (lectura)    out/ (escritura)
```

La separación que evalúa el reto está explícita en el árbol de carpetas:

- **Comportamiento** → `agent/prompt.md` (system prompt, cargado desde archivo, no embebido en código).
- **Conocimiento** → `src/knowledge/registro-contratos.md` (reglas de negocio en prosa).
- **Ejecución** → `src/tools/contratos.ts` (las herramientas, única fuente de valores).

Un cambio de regla de negocio toca el conocimiento o las herramientas; nunca `server.ts`. Un cambio
de proveedor de LLM toca solo `src/llm/`, nunca el ciclo del agente.

## 3. Ciclo del agente

Implementado en `src/agent/ciclo.ts`, función `ejecutarTurno`:

- Bucle `prompt → modelo → tool calls → ejecutar → alimentar resultado → modelo → …`.
- **Tope de iteraciones** por turno configurable (`MAX_ITERACIONES`, por defecto 25). Al alcanzarlo,
  el agente responde con lo que logró y lo que falta, en vez de colgarse (CA1).
- **El modelo no afirma valores propios**: cada valor proviene de una herramienta. El prompt lo
  prohíbe y el diseño lo hace innecesario, porque las herramientas devuelven los datos (CA2).
- **Confirmación humana** (CA3): cuando `contratos_validar`/`contratos_registrar` indican campos en
  revisión (confianza < 0.8), la herramienta devuelve `{ ok: false, error: "requiere revisión: …" }`.
  El ciclo marca `needsConfirmation`, el turno termina con una pregunta y el front resalta el estado.
  Solo si el usuario confirma, el modelo vuelve a llamar `contratos_registrar` con `confirmado: true`.
- Cada tool call queda en el historial visible del chat (vía eventos SSE) y en `out/log.jsonl` (CA4).
- Errores de herramienta o del proveedor se traducen a lenguaje claro; la sesión no muere (CA5).

El transporte al front es **SSE**: el servidor emite eventos `pensando`, `tool_call`, `tool_result`,
`respuesta` y un `fin` con el resultado del turno. Así la UI muestra el ciclo en tiempo real.

## 4. Elección del modelo y costo

- **Proveedor/modelo:** Google **Gemini 2.5 Flash**, vía `@google/genai`, detrás de la interfaz
  `LlmAdapter`. Cambiar de proveedor = nueva implementación del adaptador, sin tocar el ciclo.
- **Por qué:** experiencia previa con el stack Gemini, costo por caso muy bajo, function calling
  nativo y buena latencia para una demo conversacional.
- **Costo estimado por caso procesado:** un turno "procesa el buzón" encadena ~6–10 llamadas a
  herramientas con contexto moderado. Con las tarifas de Flash (del orden de centavos de USD por
  millón de tokens de entrada y salida), el costo por lote completo de los 6 contratos queda en el
  rango de **fracciones de centavo de dólar**. Los topes `MAX_ITERACIONES` y `MAX_TOKENS_SESION`
  acotan el gasto por sesión para que un usuario no agote la clave.

## 5. Estrategia de extracción

El corazón del reto (`src/lib/extraccion.ts`), enfoque **híbrido determinista + confianza**:

- **Determinista (P0):** regex y heurísticas sobre el texto del contrato para id, NIT/RUC/RTN,
  cliente, valor, moneda, fechas, póliza y objeto. Es reproducible y no depende del modelo.
- **Confianza por campo** en `[0,1]` con umbral de revisión en **0.8**:
  - regex canónico que matchea patrón esperado → 0.95
  - valor derivado con insumos completos (fecha_fin desde meses + fecha de firma con día) → 0.80
  - derivado con insumos incompletos (firma sin día) → 0.55
  - valor en letras y dígitos que no coinciden → 0.50
  - campo ausente / valor indeterminado → 0.00 (nunca se inventa)
- **Valor: el dígito manda sobre las letras.** Los contratos traen el monto redundante
  (`DOSCIENTOS SESENTA Y CINCO MILLONES (COP $265.000.000)`). Se extrae el dígito (alta confianza) y
  el conversor español (`numeros-es.ts`) se usa solo como verificación; si no cuadran, baja la
  confianza y entra a revisión.
- **Detección de no-contrato:** una cotización (msg-005) no tiene estructura contractual
  (CONTRATANTE/CONTRATISTA, cláusulas, objeto) → se rechaza aunque el cliente exista en el maestro.
- **Dónde entra el modelo y dónde no:** el modelo orquesta (decide qué herramienta llamar y redacta
  el resumen), pero **no escribe valores al maestro**: el valor registrado siempre pasa por las
  herramientas. Esto evita que el LLM "complete" un campo faltante con algo plausible.

Clasificación (`src/lib/clasificacion.ts`) con **precedencia**: ¿es contrato? → ¿es otrosí? (actualiza
el contrato padre) → match por `id_contrato` (el id manda: mismo id+datos = duplicado; mismo id+cambio
= actualización; id nuevo = nuevo) → fallback por similitud NIT+objeto ≥ 0.9. Así, un cliente con
varios contratos de distinto id genera filas nuevas, no actualizaciones.

## 6. Regla de gobierno (propuesta de proceso)

Una página para que el proceso **sobreviva a la rotación** y no vuelva a congelarse:

1. **Canal único.** Buzón `contratos@periferia.com`, administrado por la analista administrativa como
   dueña del maestro. Todo contrato entra por ahí; nada por correos personales.
2. **Obligación del comercial.** Enviar el PDF firmado (y otrosíes, actas de terminación) **dentro de
   los 3 días hábiles** desde la firma, con asunto normalizado:
   `[CONTRATO] <cliente> - <objeto corto>` o `[OTROSI] <id_contrato>`.
3. **Acuse automático.** El agente responde al comercial en minutos: confirma recepción, informa la
   clasificación (nuevo/actualización/duplicado) y, si hay campos en revisión, los lista para que el
   comercial complete. Un contrato sin acuse en 24 h se re-notifica.
4. **Excepciones y escalamiento.** Un documento sin firmar, sin valor o que no es contrato se marca
   `rechazado`/`revisión` y se escala a la analista; si en 5 días no se resuelve, al líder comercial
   de la región (resuelto desde `comerciales.json`).
5. **Cierre del gap jun–ago 2026.** Campaña única: se solicita a cada comercial el listado de
   contratos firmados en ese periodo; se procesan por el mismo buzón marcándolos `fuente=migracion`.
   El reporte de alertas ya distingue los "registrados desde el corte 2026-05-30" para medir avance.
6. **Indicador mensual.** % de contratos facturados en el mes que existen en el maestro. Si baja,
   el proceso se está saltando; es la señal temprana de que el canal único no se respeta.

## 7. Decisiones y trade-offs

1. **Extracción determinista con confianza, en vez de pedirle los datos al LLM.**
   Alternativa descartada: que el modelo extraiga y devuelva el JSON. Se descartó porque el modelo
   puede alucinar un valor plausible para un campo ausente, justo el riesgo que el PRD señala. El
   costo es más código de regex, pero gano reproducibilidad y un `demo.ts` determinista sin API key.

2. **El `id_contrato` como identidad primaria; similitud NIT+objeto solo como fallback.**
   Alternativa descartada: deduplicar siempre por NIT+objeto. Se descartó porque un mismo cliente
   tiene varios contratos (Industrias Delta: CT-2025-018 y CT-2026-015; Corporación Andina:
   CT-2026-007 y CT-2026-016 con mismo NIT y distinto objeto). Deduplicar por NIT los fusionaría por
   error. El id evita ese falso positivo.

3. **Hono + SSE en vez de Express + WebSocket.**
   Alternativa descartada: WebSocket bidireccional. Se descartó porque el flujo es
   petición→stream de respuesta, que SSE cubre con menos complejidad. Hono da streaming nativo y es
   TypeScript-first. Trade-off: SSE es unidireccional, pero no necesito canal inverso en vivo.

4. **Sesiones en memoria, sin base de datos.**
   El PRD lo permite y simplifica el despliegue. Trade-off: la sesión se pierde al reiniciar el
   proceso; aceptable para el alcance del reto (el estado persistente real vive en `out/`).

## 8. Supuestos

- Los fixtures representan la variabilidad real; en producción habrá contratos peor estructurados y
  se necesitará OCR para escaneos (aquí el texto viene en `contrato.txt`).
- El identificador tributario basta para inferir el país; ante conflicto doc vs. identificador, se
  baja la confianza y se marca revisión.
- La fecha de referencia de las alertas ("hoy") se pasa como argumento para que el reporte sea
  determinista y reproducible en la defensa.
- El maestro de `fixtures/` es la verdad inicial; la primera ejecución lo copia a `out/sharepoint/` y
  nunca se modifica el fixture original.

## 9. Cobertura (historias de usuario)

| HU | Estado | Nota |
|---|---|---|
| HU-1 Leer el buzón | ✅ hecho | `contratos_leer_buzon`, marca `tiene_contrato`, excluye procesados |
| HU-2 Extraer con confianza | ✅ hecho | determinista + confianza por campo; el LLM propone, no escribe |
| HU-3 Validar y clasificar | ✅ hecho | nuevo/actualización/duplicado/rechazado con precedencia por id |
| HU-4 Registrar y archivar | ✅ hecho | maestro CSV en out/, archivo en Contratos/<año>/<cliente>/, historial.jsonl |
| HU-5 Alertar | ✅ hecho | vencen ≤60d, pólizas pendientes, registrados desde el corte |
| HU-6 Manejo de errores | ✅ hecho | herramientas devuelven `{ok:false,error}`, el lote no se aborta |
| Front con tool calls + confirmación | ✅ hecho | tarjetas de tool call en vivo y banner de confirmación |
| Despliegue público | ✅ hecho | https://reto-02-periferia-it.onrender.com/ (Render, plan free) |
| Bonus módulo reutilizable | ⏳ no hecho | opcional (+10); las piezas (prompt, tools, knowledge) ya están separadas |

**Qué falta para producción:** OCR para escaneos, persistencia en BD, integración real con Exchange
y SharePoint, autenticación, y un dueño del dato del maestro.

## 10. Uso de IA

- **Asistente usado:** Kiro (IA de desarrollo) para scaffolding, redacción de código repetitivo
  (parsers, estilos), y revisión de la estructura contra el PRD.
- **Para qué:** acelerar la plomería (IO, CSV, SSE, configuración de Vite/Hono) y mantener funciones
  cortas y tipadas.
- **Qué se descartó de lo propuesto:** la idea de delegar la extracción de campos directamente al
  LLM (riesgo de alucinación); se mantuvo la extracción determinista con confianza. También se
  descartó WebSocket a favor de SSE por simplicidad.
- **Verificación propia:** cada decisión de clasificación se validó contra los 6 casos reales del
  buzón con `demo.ts`; el autor puede explicar cada archivo y cada regla.

## 11. Riesgos en producción y mitigación

| Riesgo | Mitigación |
|---|---|
| El modelo "completa" un campo faltante | Las herramientas son la única fuente de valores; el prompt prohíbe inventar; `demo.ts` lo verifica sin modelo |
| Contratos escaneados (sin texto) | Añadir OCR como paso previo a la extracción (fuera de alcance del reto) |
| Falsos duplicados por nombre del cliente | Dedupe por `id_contrato` primero, NIT después; nunca solo por nombre |
| Clave de LLM expuesta | Vive solo en variable de entorno del backend; nunca en front, logs ni respuestas; `/api/health` no la revela |
| Costo descontrolado | Topes `MAX_ITERACIONES` y `MAX_TOKENS_SESION` por sesión |
| Pérdida de sesión al reiniciar | El estado de negocio persiste en `out/`; la conversación es recuperable desde el historial si se migra a BD |
