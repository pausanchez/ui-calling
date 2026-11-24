/**
 * WhatsApp Cloud API: interactive "CTA URL" message, the native way to hand a
 * surface link to the user as a button instead of a raw URL.
 */
export function whatsappCtaMessage(opts: { to: string; body: string; url: string; buttonText: string; footer?: string }) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: opts.to,
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
