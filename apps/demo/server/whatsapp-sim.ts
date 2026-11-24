// Builds the webhooks Meta would send for the simulated chat, so the demo runs the same code
// path as a real integration (parseWhatsAppWebhook → identity → agent). IDs are fake.

const WABA_ID = "WABA-1000000001";
const PHONE_NUMBER_ID = "PN-1000000001";

/** The person on the other side of the simulated chat. */
export const demoUser = {
  bsuid: "",
  phone: "34600000000",
  username: "lucia.r",
  name: "Lucía",
  /** Off = the user only uses a WhatsApp username, so Meta leaves the phone out of webhooks. */
  phoneShared: true,
};

export function seedDemoUser() {
  demoUser.bsuid = newBsuid();
  demoUser.phone = "34600000000";
  demoUser.phoneShared = true;
}
seedDemoUser();

function newBsuid() {
  return `demo-bsuid-${crypto.randomUUID().slice(0, 8)}`;
}

function envelope(contact: object, message: object) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "+34 900 000 000", phone_number_id: PHONE_NUMBER_ID },
              contacts: [contact],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

function contact() {
  return {
    user_id: demoUser.bsuid,
    ...(demoUser.phoneShared ? { wa_id: demoUser.phone } : {}),
    profile: { name: demoUser.name, username: demoUser.username },
  };
}

/** A text message from the user. The phone (`from`, `wa_id`) is only there when Meta shares it. */
export function inboundText(text: string) {
  return envelope(contact(), {
    id: `wamid.demo.${crypto.randomUUID().slice(0, 12)}`,
    ...(demoUser.phoneShared ? { from: demoUser.phone } : {}),
    from_user_id: demoUser.bsuid,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: "text",
    text: { body: text },
  });
}

/**
 * The user changes phone number, so Meta regenerates their BSUID. It's reported as a system message:
 * `user_changed_number` when the number can be shared, `user_changed_user_id` otherwise.
 */
export function inboundNumberChange() {
  const previous = demoUser.bsuid;
  demoUser.bsuid = newBsuid();
  if (demoUser.phoneShared) demoUser.phone = "34600000001";
  const type = demoUser.phoneShared ? "user_changed_number" : "user_changed_user_id";
  return envelope(contact(), {
    id: `wamid.demo.${crypto.randomUUID().slice(0, 12)}`,
    ...(demoUser.phoneShared ? { from: demoUser.phone } : {}),
    from_user_id: demoUser.bsuid,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: "system",
    system: {
      type,
      body: type === "user_changed_number" ? `User A changed from 34600000000 to ${demoUser.phone}` : `User changed from ${previous} to ${demoUser.bsuid}`,
      previous_user_id: previous,
    },
  });
}
