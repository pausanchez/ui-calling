import { implement } from "@ui-calling/core";
import { linkAccount } from "../src/components/ui-calling/link-account.surface";
import { DEMO_CODE, customerFor, verifyAndLink } from "./identity";

/** Server-side half of "link_account": links the session's subject (the WhatsApp user) to a customer. */
export const linkAccountImpl = implement(linkAccount, {
  resolve: async ({ continue_with }, ctx) => {
    const c = customerFor(ctx.subject);
    return {
      linked: Boolean(c),
      customerId: c?.id ?? null,
      customerName: c?.name ?? null,
      continueWith: continue_with,
      demoCode: c ? null : DEMO_CODE,
    };
  },
  // Never include the code: this line goes to the agent.
  summarize: (d) =>
    d.linked
      ? `This WhatsApp chat is now linked to customer ${d.customerName} (${d.customerId}). They wanted: ${d.continueWith}.`
      : `Not linked yet: the user has to enter their email and the code we emailed. They wanted: ${d.continueWith}.`,
  on: {
    verify_identity: async ({ email, code }, ctx) => {
      // Throws SurfaceError("invalid_code") on a mismatch: the screen shows it, the agent hears about it once.
      const c = verifyAndLink(ctx.subject, email, code);
      return {
        linked: true,
        customerId: c.id,
        customerName: c.name,
        continueWith: String(ctx.session.input.continue_with),
        demoCode: null,
      };
    },
  },
});
