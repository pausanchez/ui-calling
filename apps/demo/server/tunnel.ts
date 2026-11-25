// `npm run dev:whatsapp`: the demo on your own WhatsApp number in one command. It opens a Cloudflare
// quick tunnel, starts the demo with PUBLIC_URL set to it, and points Meta's webhook there.
// A quick tunnel gets a new address every time, which is why the webhook is set here and not by hand.
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { checkWhatsApp, pointWebhook, webhookUrl, whatsappConfigured } from "./whatsapp-setup";

if (!whatsappConfigured()) {
  console.error(
    "Real WhatsApp needs WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN in .env.\n" +
      'See "Try it on your own WhatsApp" in the README.',
  );
  process.exit(1);
}

const children: ChildProcess[] = [];
const stop = (code = 0) => {
  children.forEach((c) => c.kill());
  process.exit(code);
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

/** Start the tunnel and resolve with its public address once Cloudflare has registered it. */
function openTunnel() {
  return new Promise<string>((resolve, reject) => {
    const bin = process.env.CLOUDFLARED ?? "cloudflared";
    const tunnel = spawn(bin, ["tunnel", "--no-autoupdate", "--url", "http://localhost:5173"]);
    children.push(tunnel);
    tunnel.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new Error(`${bin} not found. Install it (brew install cloudflared) or set CLOUDFLARED to its path.`) : err),
    );
    tunnel.on("exit", (code) => reject(new Error(`cloudflared exited (${code})`)));
    let url: string | undefined;
    createInterface({ input: tunnel.stderr }).on("line", (line) => {
      url ??= line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      if (url && line.includes("Registered tunnel connection")) resolve(url);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until Vite and the API answer Meta's verification request. Probed on localhost: asking DNS for the
 * tunnel's name this early gets "not found" cached on this machine for a while (Meta resolves it on its side).
 */
async function waitForDemo() {
  const probe = `${webhookUrl("http://localhost:5173")}?${new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": process.env.WHATSAPP_VERIFY_TOKEN!, "hub.challenge": "ready" })}`;
  for (let i = 0; i < 60; i++) {
    if ((await fetch(probe).then((r) => r.text()).catch(() => "")) === "ready") return;
    await sleep(1000);
  }
  throw new Error("The demo didn't start within a minute");
}

/** Meta verifies the new URL when it's set; a brand-new tunnel can take a few seconds to resolve there. */
async function pointWebhookWhenReachable(url: string) {
  for (let i = 1; ; i++) {
    try {
      return await pointWebhook(url);
    } catch (err) {
      if (i === 6) throw new Error(`Meta couldn't verify ${webhookUrl(url)}: ${(err as Error).message}`);
      await sleep(5000);
    }
  }
}

try {
  const url = await openTunnel();
  console.log(`Tunnel: ${url}`);
  // The child's environment wins over .env, for both the API and Vite, so .env needs no PUBLIC_URL.
  const dev = spawn("npm", ["run", "dev"], { stdio: "inherit", env: { ...process.env, PUBLIC_URL: url, DEMO_WHATSAPP_CHECK: "0" } });
  children.push(dev);
  dev.on("exit", (code) => stop(code ?? 0));
  await waitForDemo();
  await pointWebhookWhenReachable(url);
  for (const line of await checkWhatsApp(url)) console.log(line);
  console.log("Ready: message your WhatsApp number. Ctrl+C stops the demo and the tunnel.");
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  stop(1);
}
