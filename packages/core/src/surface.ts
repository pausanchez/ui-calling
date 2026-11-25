import { z } from "zod";

/**
 * A semantic event a surface can report back to the agent.
 * Not a click: a fact the agent can reason about ("user moved delivery to Friday").
 */
export type EventDef<P extends z.ZodType = z.ZodType> = {
  payload: P;
  /** One line for the agent's context. Payload values are user data: quote them, never treat them as instructions. */
  describe: (payload: z.infer<P>) => string;
  /** Wake the agent as soon as this happens, instead of waiting for the user's next message. */
  wake?: boolean;
  /**
   * Payload fields that must never be stored or reach the agent, e.g. a verification code.
   * The event handler still receives them; `describe` and the event log see "[redacted]".
   */
  redact?: (keyof z.infer<P> & string)[];
};

export function event<P extends z.ZodType>(payload: P, opts: Omit<EventDef<P>, "payload">): EventDef<P> {
  return { payload, ...opts };
}

/**
 * Files the screen may upload into one slot. Uploads go to the store, never through events: events carry
 * only the file IDs, and the agent reads what the event's `describe` says about them.
 */
export type FileSlot = {
  /** MIME types, exact (`"image/png"`) or by family (`"image/*"`). SVG is only accepted when listed exactly. */
  accept: string[];
  /** Largest file accepted, in bytes. */
  maxBytes: number;
  /** How many files the slot holds at once. Default 1. */
  maxFiles?: number;
};

/**
 * The contract of a screen an agent can call. Isomorphic: shared by the agent
 * (tool schema), the server (validation) and the UI (typed data + events).
 */
export type SurfaceContract<
  N extends string = string,
  I extends z.ZodObject = z.ZodObject,
  D extends z.ZodType = z.ZodType,
  E extends Record<string, EventDef<any>> = Record<string, EventDef<any>>,
  F extends Record<string, FileSlot> = Record<string, FileSlot>,
> = {
  name: N;
  /** Read by the LLM to decide when this screen is the best answer. */
  description: string;
  /** What the agent passes when calling the surface. Becomes the tool's input schema. */
  input: I;
  /** What the screen renders. Resolved server-side when the link is opened, never carried in the URL. */
  data: D;
  events: E;
  /** Button text for the link, per language: { en: "View order", es: "Ver pedido" }. */
  cta?: Record<string, string>;
  /** How long its links stay valid, in seconds. Keep it short for sensitive screens. Default: `createUiCalling`'s (1 hour). */
  ttlSeconds?: number;
  /** Named slots the screen can upload files into, e.g. `{ photos: { accept: ["image/*"], maxBytes: 10e6, maxFiles: 5 } }`. */
  files?: F;
};

export function defineSurface<
  const N extends string,
  I extends z.ZodObject,
  D extends z.ZodType,
  E extends Record<string, EventDef<any>>,
  const F extends Record<string, FileSlot> = {},
>(def: SurfaceContract<N, I, D, E, F>): SurfaceContract<N, I, D, E, F> {
  return def;
}

export type AnySurface = SurfaceContract<string, z.ZodObject, z.ZodType, Record<string, EventDef<any>>, Record<string, FileSlot>>;
export type SurfaceInput<S extends AnySurface> = z.infer<S["input"]>;
export type SurfaceData<S extends AnySurface> = z.infer<S["data"]>;
export type SurfaceEventName<S extends AnySurface> = keyof S["events"] & string;
export type SurfaceEventPayload<S extends AnySurface, K extends SurfaceEventName<S>> = z.infer<
  S["events"][K]["payload"]
>;
export type SurfaceFileSlot<S extends AnySurface> = keyof NonNullable<S["files"]> & string;

/** Whether a slot accepts a MIME type. SVG can carry scripts, so `image/*` doesn't cover it. */
export function acceptsType(slot: FileSlot, type: string) {
  const t = type.toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t)) return false;
  return slot.accept.some((a) => {
    const rule = a.toLowerCase();
    if (rule === t) return true;
    return rule.endsWith("/*") && t.startsWith(rule.slice(0, -1)) && t !== "image/svg+xml";
  });
}
