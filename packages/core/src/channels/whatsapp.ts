/**
 * WhatsApp Cloud API helpers. Field names follow Meta's docs on business-scoped user IDs (BSUIDs)
 * as of November 2026: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
 *
 * A BSUID identifies a WhatsApp user within one business portfolio: every phone number of the
 * portfolio sees the same BSUID, other portfolios see a different one. Meta only includes the
 * user's phone number when you exchanged messages or calls with it in the last 30 days, or it's
 * in your contact book, so key users by BSUID.
 */

/**
 * Interactive "CTA URL" message: hands a surface link to the user as a button instead of a raw URL.
 * Address it with `recipient` (BSUID), `to` (phone number), or both; if both are set, Meta uses `to`.
 */
export function whatsappCtaMessage(opts: {
  to?: string;
  recipient?: string;
  body: string;
  url: string;
  buttonText: string;
  footer?: string;
}) {
  if (!opts.to && !opts.recipient) throw new Error("Pass `recipient` (BSUID) or `to` (phone number)");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...(opts.to ? { to: opts.to } : {}),
    ...(opts.recipient ? { recipient: opts.recipient } : {}),
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: opts.body },
      ...(opts.footer ? { footer: { text: opts.footer } } : {}),
      action: {
        name: "cta_url",
        // WhatsApp caps button text at 20 characters.
        parameters: { display_text: opts.buttonText.slice(0, 20), url: opts.url },
      },
    },
  };
}

/** Free-form messages are only allowed within 24h of the user's last message; after that, use a template. */
export function insideServiceWindow(lastUserMessageAt: Date, now = new Date()) {
  return now.getTime() - lastUserMessageAt.getTime() < 24 * 60 * 60 * 1000;
}

/**
 * The `subject` to use for ui-calling sessions: a BSUID is only unique within its portfolio,
 * so the portfolio is part of the key. Use the same string as the key of your BSUID → customer links.
 */
export function whatsappSubject(portfolioId: string, bsuid: string) {
  return `wa:${portfolioId}:${bsuid}`;
}

/** One inbound message from a webhook, with the sender's identity flattened. */
export type WhatsAppInbound = {
  /** WhatsApp Business Account that received it (`entry[].id`). */
  wabaId: string;
  phoneNumberId?: string;
  /** The business number the user wrote to, as Meta displays it. Handy for a `https://wa.me/<digits>` return link. */
  businessPhone?: string;
  messageId: string;
  type: string;
  text?: string;
  timestamp?: string;
  /** Sender's BSUID (`messages[].from_user_id`). */
  bsuid?: string;
  /** Only for portfolios enrolled in parent BSUIDs (`messages[].from_parent_user_id`). */
  parentBsuid?: string;
  /** Only present under Meta's conditions (recent conversation or contact book). Don't rely on it. */
  phone?: string;
  username?: string;
  name?: string;
  /** Set for system messages that change the user's identifiers: update your BSUID links. */
  identityChange?: {
    kind: "user_changed_user_id" | "user_changed_number";
    previousBsuid?: string;
    previousParentBsuid?: string;
  };
};

type Json = Record<string, any>;

/** Flatten a WhatsApp `messages` webhook into one record per inbound message. Ignores other fields. */
export function parseWhatsAppWebhook(body: unknown): WhatsAppInbound[] {
  const out: WhatsAppInbound[] = [];
  for (const entry of ((body as Json)?.entry ?? []) as Json[]) {
    for (const change of (entry.changes ?? []) as Json[]) {
      if (change.field !== "messages") continue;
      const value: Json = change.value ?? {};
      const contacts: Json[] = value.contacts ?? [];
      for (const m of (value.messages ?? []) as Json[]) {
        const contact =
          contacts.find((c) => (m.from_user_id && c.user_id === m.from_user_id) || (m.from && c.wa_id === m.from)) ??
          (contacts.length === 1 ? contacts[0] : undefined);
        const sys = m.type === "system" ? m.system : undefined;
        out.push({
          wabaId: String(entry.id),
          phoneNumberId: value.metadata?.phone_number_id,
          businessPhone: value.metadata?.display_phone_number,
          messageId: m.id,
          type: m.type,
          text: m.text?.body,
          timestamp: m.timestamp,
          bsuid: m.from_user_id ?? contact?.user_id,
          parentBsuid: m.from_parent_user_id ?? contact?.parent_user_id,
          phone: m.from ?? contact?.wa_id,
          username: contact?.profile?.username,
          name: contact?.profile?.name,
          identityChange:
            sys && (sys.type === "user_changed_user_id" || sys.type === "user_changed_number")
              ? { kind: sys.type, previousBsuid: sys.previous_user_id, previousParentBsuid: sys.previous_parent_user_id }
              : undefined,
        });
      }
    }
  }
  return out;
}

/** What Meta reports about a message you sent, after the send call itself succeeded. */
export type WhatsAppStatus = {
  wabaId: string;
  phoneNumberId?: string;
  /** The `messages[0].id` (wamid) the send call returned. */
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed" | (string & {});
  timestamp?: string;
  /** Only on `failed`, e.g. 131047 when the 24h service window has closed. */
  errors?: { code: number; title?: string; details?: string }[];
};

/**
 * Flatten the `statuses` in a WhatsApp `messages` webhook. A message can still fail here after the
 * send call returned 200, so this is the only place some delivery failures show up.
 */
export function parseWhatsAppStatuses(body: unknown): WhatsAppStatus[] {
  const out: WhatsAppStatus[] = [];
  for (const entry of ((body as Json)?.entry ?? []) as Json[]) {
    for (const change of (entry.changes ?? []) as Json[]) {
      if (change.field !== "messages") continue;
      const value: Json = change.value ?? {};
      for (const s of (value.statuses ?? []) as Json[]) {
        out.push({
          wabaId: String(entry.id),
          phoneNumberId: value.metadata?.phone_number_id,
          messageId: s.id,
          status: s.status,
          timestamp: s.timestamp,
          errors: (s.errors as Json[] | undefined)?.map((e) => ({
            code: e.code,
            title: e.title ?? e.message,
            details: e.error_data?.details,
          })),
        });
      }
    }
  }
  return out;
}

/**
 * Check `X-Hub-Signature-256` on a webhook: HMAC-SHA256 of the raw body with your app secret.
 * Only trust the BSUID (and everything else in the body) when this returns true.
 */
export async function verifyWhatsAppSignature(rawBody: string, header: string | null | undefined, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
