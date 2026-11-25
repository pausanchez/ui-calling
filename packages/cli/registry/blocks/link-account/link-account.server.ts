import { SurfaceError, implement, type SurfaceData } from "@ui-calling/core";
import { identity } from "./identity";
import { linkAccount } from "./link-account.surface";

type Customer = { id: string; name: string; email: string };

/**
 * TODO: find the customer by what the user typed (an email, an employee number...), in your own data.
 * Return undefined when there's no match: the screen shows the same thing either way.
 */
async function findCustomer(identifier: string): Promise<Customer | undefined> {
  const example: Customer = { id: "C-1001", name: "Sam Taylor", email: "sam@example.com" };
  return identifier.toLowerCase() === example.email ? example : undefined;
}

/** TODO: send the code through a channel the customer already controls (email, SMS), never back to the chat. */
async function sendCode(customer: Customer, code: string) {
  console.log(`[link-account] code for ${customer.email}: ${code} (replace sendCode with a real email or SMS)`);
}

/** TODO: the customer's name, for "You're verified, Sam". */
async function nameOf(customerId: string) {
  return customerId === "C-1001" ? "Sam Taylor" : null;
}

type Data = SurfaceData<typeof linkAccount>;

/** Where this subject stands: linked, waiting for a code (also after a reload), or at the start. */
// No "we sent it to s***@…": the screen must look the same for an account that doesn't exist.
async function state(subject: string, continueWith: string): Promise<Data> {
  const customerId = identity.customerFor(subject);
  if (customerId) return { stage: "linked", name: await nameOf(customerId), continueWith };
  if (identity.pending(subject)) return { stage: "code_sent", name: null, continueWith };
  return { stage: "start", name: null, continueWith };
}

/** Server-side half of "link_account": links the session's subject (the chat user), never an ID from the screen. */
export const linkAccountImpl = implement(linkAccount, {
  resolve: async ({ continue_with }, ctx) => state(ctx.subject, continue_with),
  // Never include the code or the email: this line goes to the agent.
  summarize: (d) =>
    d.stage === "linked"
      ? `This chat is now linked to ${d.name ?? "the user's account"}. They wanted: ${JSON.stringify(d.continueWith)}.`
      : `Not linked yet (${d.stage === "code_sent" ? "a code was sent" : "no code sent yet"}). They wanted: ${JSON.stringify(d.continueWith)}.`,
  on: {
    code_requested: async ({ identifier }, ctx) => {
      const customer = await findCustomer(identifier);
      // Same answer whether or not the account exists, also after a reload, so the screen can't be used to find
      // accounts: an unknown identifier gets a code nobody receives.
      if (!customer) {
        identity.startVerification(ctx.subject, `unknown:${ctx.subject}`);
        return state(ctx.subject, ctx.input.continue_with);
      }
      const code = identity.startVerification(ctx.subject, customer.id);
      if (!code) throw new SurfaceError("try_later", "Too many wrong codes for this account; it's locked for a while", { refused: true });
      await sendCode(customer, code);
      return state(ctx.subject, ctx.input.continue_with);
    },
    code_entered: async ({ code }, ctx) => {
      const result = identity.verify(ctx.subject, code);
      if (!result.ok) {
        const retryable = result.reason === "wrong_code";
        throw new SurfaceError(result.reason, `Verification failed: ${result.reason.replace("_", " ")}`, { retryable, refused: true });
      }
      return state(ctx.subject, ctx.input.continue_with);
    },
    start_over: async (_p, ctx) => {
      identity.cancelVerification(ctx.subject);
      return state(ctx.subject, ctx.input.continue_with);
    },
  },
});
