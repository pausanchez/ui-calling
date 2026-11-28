import { SurfaceError, type Verifier } from "@ui-calling/core";

/** The demo business's portfolio. A BSUID only identifies someone together with its portfolio. */
export const PORTFOLIO_ID = "PF-1000000001";

/** Demo only: the "emailed" verification code, shown on the linking screen. */
export const DEMO_CODE = "246810";

/** Demo only: every customer's PIN for screens with `verify: true`, shown under the PIN field. */
export const DEMO_PIN = "1357";

type Customer = { id: string; name: string; phone: string; email: string };

// Stand-in for the product's CRM.
const CUSTOMERS: Customer[] = [
  { id: "C-1001", name: "Lucía Romero", phone: "+34600000000", email: "lucia.romero@example.com" },
];

/** BSUID links: session subject (wa:<portfolio>:<bsuid>) → customer id. A real product keeps these in its database. */
const links = new Map<string, string>();

/** For the demo's persistence (app.ts). */
export const linksState = {
  save: () => [...links],
  load: (rows: [string, string][]) => {
    links.clear();
    rows.forEach(([k, v]) => links.set(k, v));
  },
};

export function seedIdentity() {
  links.clear();
}

export function customerFor(subject: string) {
  const id = links.get(subject);
  return id ? CUSTOMERS.find((c) => c.id === id) : undefined;
}

/** Access check for every surface: no linked customer, no data. The agent is told why. */
export function requireCustomer(subject: string) {
  const c = customerFor(subject);
  if (!c) throw new SurfaceError("account_not_linked", "This WhatsApp user isn't linked to a customer account yet");
  return c;
}

/** Meta only shares the phone number under its conditions; when it does (in a signed webhook), it's enough to link. */
export function linkByPhone(subject: string, phone: string) {
  // Meta sends digits only ("34600000000"); CRMs often store "+34 600 000 000".
  const digits = (s: string) => s.replace(/\D/g, "");
  const c = CUSTOMERS.find((x) => digits(x.phone) === digits(phone));
  if (c) links.set(subject, c.id);
  return c;
}

/** Link after the user proves who they are. Same error for unknown email and wrong code, so emails can't be probed. */
export function verifyAndLink(subject: string, email: string, code: string) {
  const c = CUSTOMERS.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!c || code.trim() !== DEMO_CODE) {
    throw new SurfaceError("invalid_code", "The email and code don't match an account", { retryable: true, refused: true });
  }
  links.set(subject, c.id);
  return c;
}

/**
 * A BSUID is regenerated when the user changes phone number: carry the link over. The old one is
 * kept so links already sent to this person keep working until they expire.
 */
export function relink(previousSubject: string, subject: string) {
  const id = links.get(previousSubject);
  if (!id) return false;
  links.set(subject, id);
  return true;
}

/**
 * Checks the PIN on screens with `verify: true` (the shift picker). A product keeps a hashed PIN per customer and
 * locks them out after a few wrong ones, as `sqliteIdentity(store).pinVerifier()` does; the runtime also locks the link.
 */
export const demoVerifier: Verifier = {
  kind: "pin",
  check: async ({ subject }, typed) => Boolean(customerFor(subject)) && typed === DEMO_PIN,
};

export function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 1)}***@${domain}` : "***";
}
