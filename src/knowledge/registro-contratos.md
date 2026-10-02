# Conocimiento del proceso — Registro de Contratos Vigentes

Este documento describe las reglas de negocio que el agente debe conocer. Es *conocimiento*
(qué es correcto), separado del *comportamiento* (prompt) y de la *ejecución* (herramientas).

## Contexto

El maestro de contratos de Periferia está congelado desde el 2026-05-30. Antes lo alimentaba un
aprendiz que ya no está. Hoy los comerciales envían contratos a un buzón único. El agente es el punto
de recepción: lee, extrae, clasifica, registra y alerta.

## Esquema del maestro (una fila por contrato)

| Columna | Regla |
|---|---|
| id_contrato | Número tal como aparece en el documento. Si no hay, `AUTO-<año>-<secuencia>`. |
| cliente | Razón social de la contraparte. |
| nit_cliente | Identificador tributario sin puntos ni dígito de verificación. |
| pais | CO / EC / PE / PA / HN, inferido del identificador o del texto. |
| objeto | Máx. 200 caracteres. |
| valor | Sin separadores. 0 si es por demanda (valor indeterminado). |
| moneda | COP / USD / PEN / PAB / HNL. |
| fecha_inicio, fecha_fin | YYYY-MM-DD. fecha_fin puede derivarse de un plazo en meses. |
| requiere_poliza | booleano. |
| tipo_poliza | Lista separada por `;`. Vacío si no requiere. |
| estado_poliza | vigente / pendiente / vencida / no_aplica. Nuevo con póliza → pendiente. |
| comercial | Nombre resuelto desde comerciales.json por el email del remitente. |
| ruta_sharepoint | Ruta relativa en out/sharepoint/. |
| fecha_registro | YYYY-MM-DD. |
| fuente | buzon / manual / migracion. |

## Clasificación (precedencia)

1. **Rechazado**: el documento no es un contrato (es una cotización, no tiene partes ni objeto).
2. **Actualización por otrosí**: el documento es un otrosí; se actualiza el contrato padre referenciado.
3. **Match por id_contrato** (identidad primaria):
   - mismo id + mismos valor/fecha_inicio/fecha_fin → **duplicado** (no se escribe).
   - mismo id + algún campo distinto → **actualización**.
   - id no existe → **nuevo**.
4. **Fallback sin id**: similitud nit_cliente + objeto ≥ 0.9 → actualización; si no, nuevo.

El `id_contrato` manda. Un mismo cliente puede tener varios contratos con distinto id (son filas
distintas, no actualizaciones).

## Confianza y revisión humana

- Cada campo extraído tiene una confianza en [0, 1].
- Confianza < 0.8 → el campo entra en revisión y el registro se detiene hasta confirmación.
- Campo ausente en el texto → null, confianza 0. Nunca se inventa.
- El valor en dígitos manda sobre el valor en letras; si no coinciden, baja la confianza.

## Pólizas y alertas

- Un contrato nuevo con póliza nace con estado_poliza = pendiente.
- El reporte de alertas incluye: contratos que vencen en ≤ 60 días, pólizas pendientes o no vigentes,
  y contratos registrados desde el corte (2026-05-30).
- La fecha de referencia ("hoy") se pasa como argumento para que el reporte sea determinista.

## Identificadores por país

- NIT Colombia: 9 dígitos (ej. 890900111).
- RUC Ecuador: 13 dígitos que empiezan en 17.
- RUC Perú: 11 dígitos que empiezan en 20.
- RUC Panamá: formato con guiones.
- RTN Honduras: 14 dígitos.
