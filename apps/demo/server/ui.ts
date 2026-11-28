import { createUiCalling, type UiEvent } from "@ui-calling/core";
import { sqliteStore } from "@ui-calling/sqlite";
import { failures } from "./failures";
import { orderReturnImpl } from "./order-return.server";
import { orderStatusImpl } from "./order-status.server";
import { shiftPickerImpl } from "./shift-picker.server";
import { linkAccountImpl } from "./link-account.server";
import { jobApplicationImpl } from "./job-application.server";
import { demoVerifier } from "./identity";

export { failures };

export const PUBLIC_URL = process.env.PUBLIC_URL ?? "http://localhost:5173";

const listeners = new Set<(e: UiEvent) => void>();
export const onUiEvent = (fn: (e: UiEvent) => void) => listeners.add(fn);

/** Sessions and events survive restarts. The demo keeps its own state in the same file (see app.ts). */
export const store = sqliteStore(process.env.UI_CALLING_DB ?? ".ui-calling/demo.db");

export const ui = createUiCalling({
  baseUrl: PUBLIC_URL,
  store,
  abandonAfterMs: Number(process.env.ABANDON_AFTER_MS ?? 90_000),
  onEvent: (e) => listeners.forEach((fn) => fn(e)),
  // UI_CALLING_TRACE=1 prints each step of every interaction: how a tap became an event, and where it failed.
  onTrace: process.env.UI_CALLING_TRACE
    ? (t) =>
        console.log(
          `[trace] ${t.sessionId.slice(0, 6)} ${t.step}`,
          [t.type, t.key && `key ${t.key.slice(0, 8)}`, t.ms !== undefined && `${t.ms}ms`, t.outcome, t.kind, t.reason, t.wake && "wake"].filter(Boolean).join(" "),
        )
    : undefined,
  // The shift picker asks for the worker's PIN before it shows their rota (`verify: true` on its contract).
  verifier: demoVerifier,
  surfaces: [
    orderStatusImpl,
    orderReturnImpl,
    shiftPickerImpl,
    linkAccountImpl,
    jobApplicationImpl,
  ],
});
