/**
 * types.ts — Tipos del dominio de registro de contratos.
 * Fuente de verdad de los esquemas que fluyen entre herramientas.
 */

export type Pais = "CO" | "EC" | "PE" | "PA" | "HN";
export type Moneda = "COP" | "USD" | "PEN" | "PAB" | "HNL";
export type EstadoPoliza = "vigente" | "pendiente" | "vencida" | "no_aplica";
export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado";
export type Fuente = "buzon" | "manual" | "migracion";

/** Un valor extraído junto con su nivel de confianza en [0, 1]. */
export type CampoConf<T> = { valor: T | null; confianza: number };

/** Correo normalizado del buzón. */
export interface Correo {
  id: string;
  de: string;
  para: string;
  asunto: string;
  fecha: string;
  cuerpo: string;
  adjuntos: string[];
}

/** Resumen de un mensaje para `contratos_leer_buzon`. */
export interface MensajeResumen {
  id: string;
  de: string;
  asunto: string;
  fecha: string;
  adjuntos: string[];
  tiene_contrato: boolean;
}

/**
 * Contrato extraído. Cada campo "incierto" lleva confianza por separado.
 * Mapea 1:1 con las columnas del maestro CSV (ver §6 del diseño).
 */
export interface Contrato {
  id_contrato: CampoConf<string>;
  cliente: CampoConf<string>;
  nit_cliente: CampoConf<string>;
  pais: CampoConf<Pais>;
  objeto: CampoConf<string>;
  valor: CampoConf<number>;
  valor_indeterminado: boolean;
  moneda: CampoConf<Moneda>;
  fecha_inicio: CampoConf<string>;
  fecha_fin: CampoConf<string>;
  requiere_poliza: CampoConf<boolean>;
  tipo_poliza: CampoConf<string>;
  estado_poliza: EstadoPoliza;
  comercial: CampoConf<string>;
  es_otrosi: boolean;
  id_contrato_padre: string | null;
}

/** Fila del maestro de contratos (CSV). */
export interface FilaMaestro {
  id_contrato: string;
  cliente: string;
  nit_cliente: string;
  pais: string;
  objeto: string;
  valor: string;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  requiere_poliza: string;
  tipo_poliza: string;
  estado_poliza: string;
  comercial: string;
  ruta_sharepoint: string;
  fecha_registro: string;
  fuente: string;
}

/** Resultado de clasificar/validar un contrato contra el maestro. */
export interface ResultadoValidacion {
  clasificacion: Clasificacion;
  id_contrato_existente?: string;
  requiere_revision: string[];
  diferencias?: Record<string, { antes: string; despues: string }>;
  motivo_rechazo?: string;
  remitente_desconocido?: boolean;
}

/** Comercial de comerciales.json. */
export interface Comercial {
  email: string;
  nombre: string;
  region: string;
}

/** Respuesta uniforme de toda herramienta. Nunca lanza. */
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Contexto que recibe cada herramienta. */
export interface ToolContext {
  directory: string;
  sessionId: string;
}
