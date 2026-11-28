import { createUiCalling, type UiEvent } from "@ui-calling/core";
import { sqliteStore } from "@ui-calling/sqlite";
import { failures } from "./failures";
import { orderReturnImpl } from "./order-return.server";
import { orderStatusImpl } from "./order-status.server";
import { shiftPickerImpl } from "./shift-picker.server";
import { linkAccountImpl } from "./link-account.server";
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
  // The shift picker asks for the worker's PIN before it shows their rota (`verify: true` on its contract).
  verifier: demoVerifier,
  surfaces: [
    orderStatusImpl,
    orderReturnImpl,
    shiftPickerImpl,
    linkAccountImpl,
  ],
});
