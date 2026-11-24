import { useState, type ReactNode } from "react";
import { pickLocalized } from "@ui-calling/core";
import { SurfaceActionError, useSurface } from "@ui-calling/react";
import { linkAccount } from "./link-account.surface";

/** Every string on the screen. Add a language by adding a key; override strings with the `messages` prop. */
export const LINK_ACCOUNT_MESSAGES = {
  en: {
    title: "Verify it's you",
    intro: "To show you personal details in this chat, we need to link it to your account once.",
    email: "Email on your account",
    emailPlaceholder: "name@example.com",
    code: "Code we emailed you",
    demoHint: (code: string) => `Demo: the emailed code is ${code}`,
    verify: "Verify",
    linked: (name: string) => `Thanks, ${name}. Your chat is linked`,
    assistantKnows: "Your assistant already knows and will carry on with what you asked.",
    backToChat: "Back to chat",
    invalidCode: "That email and code don't match. Check both and try again.",
    actionFailed: "We couldn't verify you right now",
    actionFailedBody: "Your assistant already knows. You can try again or go back to the chat.",
    tryAgain: "Try again",
    unavailable: "This page isn't available right now",
    unavailableBody: "Your assistant already knows and will follow up in the chat.",
    expired: "This link has expired",
    loadError: "We couldn't load this page",
    askNewLink: "Ask your assistant for a new link.",
  },
  es: {
    title: "Verifica que eres tú",
    intro: "Para enseñarte datos personales en este chat, tenemos que vincularlo a tu cuenta una vez.",
    email: "Email de tu cuenta",
    emailPlaceholder: "nombre@ejemplo.com",
    code: "Código que te hemos enviado por email",
    demoHint: (code: string) => `Demo: el código enviado es ${code}`,
    verify: "Verificar",
    linked: (name: string) => `Gracias, ${name}. Tu chat está vinculado`,
    assistantKnows: "Tu asistente ya lo sabe y seguirá con lo que le pediste.",
    backToChat: "Volver al chat",
    invalidCode: "El email y el código no coinciden. Revisa ambos y vuelve a intentarlo.",
    actionFailed: "No hemos podido verificarte ahora mismo",
    actionFailedBody: "Tu asistente ya lo sabe. Puedes intentarlo de nuevo o volver al chat.",
    tryAgain: "Reintentar",
    unavailable: "Esta página no está disponible ahora mismo",
    unavailableBody: "Tu asistente ya lo sabe y te escribirá por el chat.",
    expired: "Este enlace ha caducado",
    loadError: "No hemos podido cargar esta página",
    askNewLink: "Pídele un enlace nuevo a tu asistente.",
  },
};

export type LinkAccountMessages = (typeof LINK_ACCOUNT_MESSAGES)["en"];

export function LinkAccount({ messages }: { messages?: Partial<LinkAccountMessages> }) {
  const { status, data, errorCode, locale, emit, complete, returnUrl } = useSurface(linkAccount);
  const t: LinkAccountMessages = { ...pickLocalized(LINK_ACCOUNT_MESSAGES, locale)!, ...messages };
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<null | "invalid" | "failed">(null);

  if (status === "loading") return <Shell><div className="h-40 animate-pulse rounded-lg bg-muted" /></Shell>;
  if (status !== "ready" || !data) {
    const upstream = errorCode === "upstream_error";
    return (
      <Shell>
        <Card>
          <p className="font-medium">{status === "expired" ? t.expired : upstream ? t.unavailable : t.loadError}</p>
          <p className="mt-1 text-sm text-muted-foreground">{upstream ? t.unavailableBody : t.askNewLink}</p>
        </Card>
      </Shell>
    );
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await emit("verify_identity", { email, code });
    } catch (err) {
      // The server already told the agent; here we only explain it to the user.
      setError(err instanceof SurfaceActionError && err.reason === "invalid_code" ? "invalid" : "failed");
    } finally {
      setBusy(false);
    }
  }

  if (data.linked && data.customerName) {
    return (
      <Shell>
        <Card className="border-success/40 bg-success/10">
          <p className="font-medium">{t.linked(data.customerName.split(" ")[0])}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.assistantKnows}</p>
          {returnUrl && (
            <a href={returnUrl} onClick={() => void complete()} className={btn("primary", "mt-3 w-full")}>
              {t.backToChat}
            </a>
          )}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.intro}</p>
      </header>

      {error === "failed" && (
        <Card className="border-destructive/40 bg-destructive/10">
          <p className="font-medium">{t.actionFailed}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.actionFailedBody}</p>
        </Card>
      )}

      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <label className="text-sm font-medium">
            {t.email}
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailPlaceholder}
              className={field}
            />
          </label>
          <label className="text-sm font-medium">
            {t.code}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${field} tracking-widest`}
            />
          </label>
          {data.demoCode && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t.demoHint(data.demoCode)}</p>}
          {error === "invalid" && <p className="text-sm text-destructive">{t.invalidCode}</p>}
          <button disabled={busy} className={btn("primary", "w-full")}>{error === "failed" ? t.tryAgain : t.verify}</button>
        </form>
      </Card>
    </Shell>
  );
}

const field =
  "mt-1 block h-11 w-full rounded-md border border-border bg-background px-3 text-base font-normal outline-none focus:ring-2 focus:ring-ring";

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">{children}</div>
    </main>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-border bg-card p-4 text-card-foreground ${className}`}>{children}</section>;
}

function btn(variant: "primary" | "outline", extra = "") {
  const base =
    "inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-card hover:bg-muted",
  }[variant];
  return `${base} ${v} ${extra}`;
}
