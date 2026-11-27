// `ui-calling whatsapp`: connect your app to a real WhatsApp number while you develop.
//   check  is the setup right? The token, and where Meta delivers messages.
//   dev    open a Cloudflare quick tunnel, start your dev server with PUBLIC_URL set to it, and point the
//          Meta app's webhook there (a quick tunnel gets a new address every time, so this beats doing it by hand).
// Reads WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN from the
// environment or .env.local / .env, and never prints them.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const GRAPH = "https://graph.facebook.com/v25.0";
const KEYS = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"];
const env = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function graph(path, token, body) {
  const url = new URL(`${GRAPH}/${path}`);
  if (!body) url.searchParams.set("access_token", token);
  const res = await fetch(url, { method: body ? "POST" : "GET", body: body && new URLSearchParams({ ...body, access_token: token }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? `Graph API ${res.status}`);
  return json;
}

/** The Meta app behind the token, and an app token for its webhook settings. */
async function metaApp() {
  const app = await graph("app", env.WHATSAPP_TOKEN);
  return { id: String(app.id), token: `${app.id}|${env.WHATSAPP_APP_SECRET}` };
}

/** One line per problem, or one line saying all is well. Catches what fails silently: an expired token, an old address. */
async function check(webhook) {
  let debug;
  try {
    debug = (await graph(`debug_token?input_token=${encodeURIComponent(env.WHATSAPP_TOKEN)}`, env.WHATSAPP_TOKEN)).data;
    if (!debug?.is_valid) throw new Error("invalid");
  } catch {
    return [`✗ WHATSAPP_TOKEN is invalid or expired: replies won't go out. Make a new one; a system user's token doesn't expire.`];
  }
  const problems = [];
  try {
    const app = await metaApp();
    await graph(`${env.WHATSAPP_PHONE_NUMBER_ID}?fields=id`, env.WHATSAPP_TOKEN).catch((err) => problems.push(`✗ WHATSAPP_PHONE_NUMBER_ID isn't reachable with this token: ${err.message}`));
    const sub = (await graph(`${app.id}/subscriptions`, app.token)).data?.find((s) => s.object === "whatsapp_business_account");
    if (!sub) problems.push("✗ The Meta app has no WhatsApp webhook. Run `npx ui-calling whatsapp dev`.");
    else {
      if (webhook && sub.callback_url !== webhook) problems.push(`✗ Meta delivers messages to ${sub.callback_url}, not ${webhook}. Run \`npx ui-calling whatsapp dev\`.`);
      if (!sub.fields?.some((f) => f.name === "messages")) problems.push('✗ The webhook isn\'t subscribed to "messages".');
    }
    if (problems.length) return problems;
    const hours = debug.expires_at ? Math.round((debug.expires_at * 1000 - Date.now()) / 3_600_000) : null;
    return [`✓ WhatsApp: token valid (${hours === null ? "doesn't expire" : `expires in ${hours} h`}), Meta delivers to ${sub.callback_url}`];
  } catch (err) {
    return [`✗ WhatsApp check failed: ${err.message}`];
  }
}

/** Open the tunnel; resolve with its public address once Cloudflare has registered it. */
function openTunnel(port, children) {
  return new Promise((resolve, reject) => {
    const bin = env.CLOUDFLARED ?? "cloudflared";
    const tunnel = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`]);
    children.push(tunnel);
    tunnel.on("error", (err) => reject(err.code === "ENOENT" ? new Error(`${bin} not found. Install it (brew install cloudflared) or set CLOUDFLARED to its path.`) : err));
    tunnel.on("exit", (code) => reject(new Error(`cloudflared exited (${code})`)));
    let url;
    createInterface({ input: tunnel.stderr }).on("line", (line) => {
      url ??= line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      if (url && line.includes("Registered tunnel connection")) resolve(url);
    });
  });
}

export async function whatsapp(sub, { flag, devCommand, defaultPort }) {
  for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f); // never overrides what's already set
  const missing = KEYS.filter((k) => !env[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")} (in the environment, .env.local or .env). Where each comes from: the ui-calling README, "Try it on your own WhatsApp".`);
    process.exit(1);
  }
  const path = flag("--webhook-path", "/api/whatsapp/webhook");

  if (sub === "check") {
    const base = flag("--url", env.PUBLIC_URL);
    for (const line of await check(base ? `${base.replace(/\/$/, "")}${path}` : undefined)) console.log(line);
    return;
  }
  if (sub !== "dev") {
    console.error("Usage: ui-calling whatsapp check [--url https://your-app] | whatsapp dev [--port 3000] [--webhook-path /api/whatsapp/webhook] [-- your dev command]");
    process.exit(1);
  }

  // Next.js: `next dev` serves its scripts only to localhost unless the tunnel's host is in allowedDevOrigins.
  const nextConfig = ["next.config.ts", "next.config.mjs", "next.config.js"].find((f) => existsSync(f));
  if (nextConfig && !readFileSync(nextConfig, "utf8").includes("allowedDevOrigins")) {
    console.warn(
      `! ${nextConfig} has no allowedDevOrigins: on a phone the screens will stay blank in next dev. Add\n` +
        `    allowedDevOrigins: process.env.PUBLIC_URL ? [new URL(process.env.PUBLIC_URL).hostname] : [],\n` +
        `  to its config (npx ui-calling init does this for new setups).`,
    );
  }
  const port = Number(flag("--port", defaultPort));
  const children = [];
  const stop = (code = 0) => {
    children.forEach((c) => c.kill());
    process.exit(code);
  };
  process.on("SIGINT", () => stop());
  process.on("SIGTERM", () => stop());
  try {
    const url = await openTunnel(port, children);
    console.log(`Tunnel: ${url}`);
    // The dev server gets the tunnel's address as PUBLIC_URL, so the links it mints work on a phone.
    const [cmd, ...args] = devCommand.length ? devCommand : ["npm", "run", "dev"];
    const dev = spawn(cmd, args, { stdio: "inherit", env: { ...env, PUBLIC_URL: url } });
    children.push(dev);
    dev.on("exit", (code) => stop(code ?? 0));
    // Wait for your webhook on localhost: asking DNS for the brand-new tunnel name now would cache "not found" here.
    const probe = `http://localhost:${port}${path}?${new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": env.WHATSAPP_VERIFY_TOKEN, "hub.challenge": "ready" })}`;
    for (let i = 0; ; i++) {
      if ((await fetch(probe).then((r) => r.text()).catch(() => "")) === "ready") break;
      if (i === 90) throw new Error(`${probe.split("?")[0]} didn't answer Meta's verification within 90 s. Is that your webhook route, and does it echo hub.challenge?`);
      await sleep(1000);
    }
    // Meta verifies the URL when it's set; a new tunnel can take a few seconds to resolve on its side.
    const app = await metaApp();
    for (let i = 1; ; i++) {
      try {
        await graph(`${app.id}/subscriptions`, app.token, { object: "whatsapp_business_account", callback_url: `${url}${path}`, verify_token: env.WHATSAPP_VERIFY_TOKEN, fields: "messages" });
        break;
      } catch (err) {
        if (i === 6) throw new Error(`Meta couldn't verify ${url}${path}: ${err.message}`);
        await sleep(5000);
      }
    }
    for (const line of await check(`${url}${path}`)) console.log(line);
    console.log("Ready: message your WhatsApp number. Ctrl+C stops the tunnel and the dev server. The Meta app now delivers here, not to any other app.");
  } catch (err) {
    console.error(`✗ ${err.message}`);
    stop(1);
  }
}
