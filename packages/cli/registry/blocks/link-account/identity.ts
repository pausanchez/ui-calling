import { sqliteIdentity } from "@ui-calling/sqlite";
import { store } from "../../../templates/init/store";

/**
 * Who each chat user is: links between a session subject (a WhatsApp BSUID) and your customer or employee ID, and
 * the one-time codes that prove it. Its own file so your other surfaces, your webhook (linking by phone, number
 * changes) and your back office can import it without importing a surface.
 *
 *   identity.customerFor(ctx.subject)   // undefined until linked: refuse to load personal data
 */
export const identity = sqliteIdentity(store);
