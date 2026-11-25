// Connecting the demo to a real WhatsApp number: check the setup at startup, and point Meta's webhook
// at PUBLIC_URL (see tunnel.ts). Both read Meta's Graph API with the keys in .env and never print them.

const GRAPH = "https://graph.facebook.com/v25.0";
const env = process.env;

type Graph = Record<string, any>;

async function graph(path: string, token: string, init?: { method: "POST"; body: Record<string, string> }): Promise<Graph> {
  const url = new URL(`${GRAPH}/${path}`);
  let body: URLSearchParams | undefined;
  if (init) body = new URLSearchParams({ ...init.body, access_token: token });
  else url.searchParams.set("access_token", token);
  const res = await fetch(url, { method: init?.method ?? "GET", body });
  const json = (await res.json().catch(() => ({}))) as Graph;
  if (!res.ok) throw new Error(json.error?.message ?? `Graph API ${res.status}`);
  return json;
}

export const webhookUrl = (publicUrl: string) => `${publicUrl.replace(/\/$/, "")}/api/whatsapp/webhook`;

/** True when .env has everything a real WhatsApp number needs. */
export const whatsappConfigured = () =>
  Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN);

/** The Meta app behind the token, and an app token for its webhook settings. */
async function metaApp() {
  const app = await graph("app", env.WHATSAPP_TOKEN!);
  return { id: String(app.id), token: `${app.id}|${env.WHATSAPP_APP_SECRET}` };
}

async function webhookSubscription(app: { id: string; token: string }) {
  const subs = await graph(`${app.id}/subscriptions`, app.token);
  return (subs.data as Graph[] | undefined)?.find((s) => s.object === "whatsapp_business_account");
}

/**
 * One line per problem, or one line saying all is well. Catches what fails silently: an expired token
 * (replies stop going out) and Meta delivering to an old tunnel (messages never arrive).
 */
export async function checkWhatsApp(publicUrl: string): Promise<string[]> {
  if (!whatsappConfigured()) return [];
  // Plain `npm run dev` with WhatsApp keys in .env: the simulated phone works, a real one can't reach us.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(publicUrl)) {
    return [`· WhatsApp keys are set, but PUBLIC_URL is ${publicUrl}: for your own phone, run \`npm run dev:whatsapp\` instead.`];
  }
  const problems: string[] = [];
  const expected = webhookUrl(publicUrl);
  let debug: Graph;
  try {
    debug = (await graph(`debug_token?input_token=${encodeURIComponent(env.WHATSAPP_TOKEN!)}`, env.WHATSAPP_TOKEN!)).data;
    if (!debug?.is_valid) throw new Error("invalid");
  } catch {
    // Meta's temporary tokens last about a day; a system user's token doesn't expire.
    return [`✗ WHATSAPP_TOKEN is invalid or expired: replies won't go out. Generate a new one in Meta: WhatsApp → API Setup.`];
  }
  try {
    const app = await metaApp();
    await graph(`${env.WHATSAPP_PHONE_NUMBER_ID}?fields=id`, env.WHATSAPP_TOKEN!).catch((err: Error) => {
      problems.push(`✗ WHATSAPP_PHONE_NUMBER_ID isn't reachable with this token: ${err.message}`);
    });
    const sub = await webhookSubscription(app);
    if (!sub) problems.push(`✗ The Meta app has no WhatsApp webhook. Run \`npm run dev:whatsapp\`.`);
    else {
      if (sub.callback_url !== expected) {
        problems.push(`✗ Meta delivers messages to ${sub.callback_url}, not ${expected}. Run \`npm run dev:whatsapp\`.`);
      }
      if (!(sub.fields as Graph[]).some((f) => f.name === "messages")) problems.push(`✗ The webhook isn't subscribed to "messages".`);
    }
    if (problems.length) return problems;
    const hours = debug.expires_at ? Math.round((debug.expires_at * 1000 - Date.now()) / 3_600_000) : null;
    const expiry = hours === null ? "doesn't expire" : `expires in ${hours} h`;
    const ok = `✓ WhatsApp: token valid (${expiry}), Meta delivers to ${expected}`;
    return hours !== null && hours < 24 ? [ok, `  A system user's token doesn't expire: Meta Business settings → System users.`] : [ok];
  } catch (err) {
    return [`✗ WhatsApp check failed: ${(err as Error).message}`];
  }
}

/** Point the Meta app's WhatsApp webhook at this URL. Meta calls it to verify, so the server must be up. */
export async function pointWebhook(publicUrl: string) {
  const app = await metaApp();
  await graph(`${app.id}/subscriptions`, app.token, {
    method: "POST",
    body: {
      object: "whatsapp_business_account",
      callback_url: webhookUrl(publicUrl),
      verify_token: env.WHATSAPP_VERIFY_TOKEN!,
      fields: "messages",
    },
  });
}
