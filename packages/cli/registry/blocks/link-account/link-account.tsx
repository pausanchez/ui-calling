import { useState, type ReactNode } from "react";
import { pickLocalized } from "@ui-calling/core";
import { SurfaceActionError, useSurface } from "@ui-calling/react";
import { linkAccount } from "./link-account.surface";

/** Every string the screen shows. Add a language by adding a key; override single strings with the `messages` prop.
 * Not exported: a file that only exports components keeps Fast Refresh working. */
const LINK_ACCOUNT_MESSAGES = {
  en: {
    title: "Verify it's you",
    intro: "So your assistant can help with your account, we'll send a code to the email you use with us.",
    identifierLabel: "Email",
    identifierPlaceholder: "you@example.com",
    sendCode: "Send code",
    codeTitle: "Enter your code",
    codeSentTo: (to: string) => `We sent a code to ${to}. It works for 10 minutes.`,
    codeSentAny: "If that email matches an account, we sent a code to it. It works for 10 minutes.",
    codeLabel: "Code",
    verify: "Verify",
    startOver: "Use a different email",
    linked: (name: string | null) => (name ? `You're verified, ${name.split(" ")[0]}` : "You're verified"),
    linkedBody: "Your assistant can help with your account now. Go back to the chat to carry on.",
    backToChat: "Back to chat",
    finish: "Finish",
    errors: {
      wrong_code: "That code isn't right. Check it and try again.",
      expired: "That code has expired. Start over to get a new one.",
      no_code: "There's no code waiting. Start over to get one.",
      locked: "Too many tries. Wait a few minutes and start over.",
      try_later: "Too many tries. Wait a few minutes and try again.",
    } as Record<string, string>,
    offline: "We couldn't reach the server. Check your connection and try again.",
    failed: "That didn't go through. Try again in a moment.",
    unavailable: "This page isn't available right now",
    expiredLink: "This link has expired",
    askNewLink: "Ask your assistant for a new link.",
  },
  es: {
    title: "Verifica que eres tú",
    intro: "Para que tu asistente pueda ayudarte con tu cuenta, te enviaremos un código al email que usas con nosotros.",
    identifierLabel: "Email",
    identifierPlaceholder: "tu@ejemplo.com",
    sendCode: "Enviar código",
    codeTitle: "Escribe tu código",
    codeSentTo: (to: string) => `Te hemos enviado un código a ${to}. Sirve durante 10 minutos.`,
    codeSentAny: "Si ese email corresponde a una cuenta, le hemos enviado un código. Sirve durante 10 minutos.",
    codeLabel: "Código",
    verify: "Verificar",
    startOver: "Usar otro email",
    linked: (name: string | null) => (name ? `Ya estás verificado, ${name.split(" ")[0]}` : "Ya estás verificado"),
    linkedBody: "Tu asistente ya puede ayudarte con tu cuenta. Vuelve al chat para seguir.",
    backToChat: "Volver al chat",
    finish: "Terminar",
    errors: {
      wrong_code: "Ese código no es correcto. Revísalo y vuelve a intentarlo.",
      expired: "Ese código ha caducado. Empieza de nuevo para recibir otro.",
      no_code: "No hay ningún código pendiente. Empieza de nuevo para recibir uno.",
      locked: "Demasiados intentos. Espera unos minutos y empieza de nuevo.",
      try_later: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
    } as Record<string, string>,
    offline: "No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.",
    failed: "No se ha podido completar. Inténtalo de nuevo en un momento.",
    unavailable: "Esta página no está disponible ahora mismo",
    expiredLink: "Este enlace ha caducado",
    askNewLink: "Pídele un enlace nuevo a tu asistente.",
  },
};

export type LinkAccountMessages = (typeof LINK_ACCOUNT_MESSAGES)["en"];

/** What users type to be found: the input's type, keyboard and autofill follow it. */
const IDENTIFIER = {
  email: { type: "email", inputMode: "email", autoComplete: "email" },
  tel: { type: "tel", inputMode: "tel", autoComplete: "tel" },
  text: { type: "text", inputMode: "text", autoComplete: "username" },
} as const;

export function LinkAccount({
  identifier: kind = "email",
  locales,
  messages,
}: {
  /** "email" (default), "tel" for phone numbers, "text" for anything else (an employee number). Change the label in `locales`. */
  identifier?: keyof typeof IDENTIFIER;
  /** Your strings per language, e.g. { en: { identifierLabel: "Employee number" }, es: { identifierLabel: "Número de empleado" } }. */
  locales?: Record<string, Partial<LinkAccountMessages>>;
  /** Strings for every language at once. */
  messages?: Partial<LinkAccountMessages>;
}) {
  const { status, data, locale, emit, complete, returnUrl } = useSurface(linkAccount);
  // Your strings only for the language they're written in: no English label on a Spanish screen.
  const own = locales?.[locale] ?? locales?.[locale.split("-")[0]];
  const t: LinkAccountMessages = { ...pickLocalized(LINK_ACCOUNT_MESSAGES, locale)!, ...own, ...messages };
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (status === "loading") return <Shell><div className="h-40 animate-pulse rounded-lg bg-muted" /></Shell>;
  if (status !== "ready" || !data) {
    return (
      <Shell>
        <Card>
          <p className="font-medium">{status === "expired" ? t.expiredLink : t.unavailable}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.askNewLink}</p>
        </Card>
      </Shell>
    );
  }

  /** Send an event; on failure, say why in the user's words. The agent already knows. */
  async function send(run: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await run();
    } catch (err) {
      const e = err instanceof SurfaceActionError ? err : null;
      setProblem((e?.reason && t.errors[e.reason]) || (!e || e.code === "network" ? t.offline : t.failed));
    } finally {
      setBusy(false);
    }
  }

  const input = "h-11 w-full rounded-md border border-border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring";

  return (
    <Shell>
      {data.stage === "linked" ? (
        <Card className="border-success/40 bg-success/10">
          <p className="font-medium">{t.linked(data.name)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.linkedBody}</p>
          {/* complete() tells the agent the user is done here, and closes the link. */}
          {returnUrl ? (
            <a href={returnUrl} onClick={() => void complete().catch(() => {})} className={btn("primary", "mt-3 w-full")}>{t.backToChat}</a>
          ) : (
            <button onClick={() => void complete().catch(() => {})} className={btn("primary", "mt-3 w-full")}>{t.finish}</button>
          )}
        </Card>
      ) : data.stage === "start" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send(() => emit("code_requested", { identifier }));
          }}
        >
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t.intro}</p>
          </header>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t.identifierLabel}
            <input {...IDENTIFIER[kind]} required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={t.identifierPlaceholder} className={input} />
          </label>
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <button type="submit" disabled={busy || !identifier.trim()} className={btn("primary")}>{t.sendCode}</button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send(() => emit("code_entered", { code }));
          }}
        >
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{t.codeTitle}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{data.sentTo ? t.codeSentTo(data.sentTo) : t.codeSentAny}</p>
          </header>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t.codeLabel}
            {/* one-time-code lets the phone offer the code from an SMS or email. */}
            <input inputMode="numeric" autoComplete="one-time-code" required maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} className={`${input} tracking-[0.3em]`} />
          </label>
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <button type="submit" disabled={busy || !code.trim()} className={btn("primary")}>{t.verify}</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCode("");
              void send(() => emit("start_over", {}));
            }}
            className={btn("outline")}
          >
            {t.startOver}
          </button>
        </form>
      )}
    </Shell>
  );
}

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
