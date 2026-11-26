import { useState, type ReactNode } from "react";
import { pickLocalized, type SurfaceData } from "@ui-calling/core";
import { SurfaceActionError, useSurface, useSurfaceSteps } from "@ui-calling/react";
import { Card, Shell, Skeleton, btn } from "../../registry/parts/screen-kit";
import { ActionBar } from "../../registry/parts/action-bar";
import { ChoiceCard } from "../../registry/parts/choice-card";
import { StepBar } from "../../registry/parts/step-bar";
import { __const__, __const__Steps } from "./__name__.surface";

/** Every string on the screen. Add a language by adding a key; override strings with the `messages` prop.
 * Not exported: a file that only exports components keeps Fast Refresh working. */
const __MESSAGES__ = {
  en: {
    steps: { details: "Details", choice: "Choice", review: "Review" },
    detailsTitle: "Tell us what happened",
    detailsPlaceholder: "A few words are enough",
    choiceTitle: "Pick one",
    reviewTitle: "Check and send",
    edit: "Edit",
    back: "Back",
    next: "Continue",
    submit: "Send",
    sent: "Sent",
    sentBody: (ref: string) => `Your reference is ${ref}. Your assistant already knows.`,
    backToChat: "Back to chat",
    finish: "Finish",
    offline: "We couldn't reach the server. Check your connection and try again.",
    failed: "That didn't go through. Your assistant already knows.",
    tryAgain: "Try again",
    errors: { details_missing: "Write a few words first.", unknown_choice: "That option isn't available any more." } as Record<string, string>,
    unavailable: "This page isn't available right now",
    unavailableBody: "Your assistant already knows and will follow up in the chat.",
    refused: "This page can't be shown",
    refusedBody: "Go back to the chat: your assistant can help.",
    expired: "This link has expired",
    otherDevice: "This link was already opened on another device",
    loadError: "We couldn't load this page",
    askNewLink: "Ask your assistant for a new link.",
  },
  es: {
    steps: { details: "Detalles", choice: "Opción", review: "Revisar" },
    detailsTitle: "Cuéntanos qué ha pasado",
    detailsPlaceholder: "Con unas palabras basta",
    choiceTitle: "Elige una",
    reviewTitle: "Revisa y envía",
    edit: "Cambiar",
    back: "Atrás",
    next: "Continuar",
    submit: "Enviar",
    sent: "Enviado",
    sentBody: (ref: string) => `Tu referencia es ${ref}. Tu asistente ya lo sabe.`,
    backToChat: "Volver al chat",
    finish: "Terminar",
    offline: "No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.",
    failed: "No se ha podido completar. Tu asistente ya lo sabe.",
    tryAgain: "Reintentar",
    errors: { details_missing: "Escribe unas palabras primero.", unknown_choice: "Esa opción ya no está disponible." } as Record<string, string>,
    unavailable: "Esta página no está disponible ahora mismo",
    unavailableBody: "Tu asistente ya lo sabe y te escribirá por el chat.",
    refused: "Esta página no se puede mostrar",
    refusedBody: "Vuelve al chat: tu asistente te ayuda.",
    expired: "Este enlace ha caducado",
    otherDevice: "Este enlace ya se abrió en otro dispositivo",
    loadError: "No hemos podido cargar esta página",
    askNewLink: "Pídele un enlace nuevo a tu asistente.",
  },
};

export type __Component__Messages = (typeof __MESSAGES__)["en"];
type Data = SurfaceData<typeof __const__>;
type Step = (typeof __const__Steps)[number];

/** The screen's states. The steps live in <Steps>, which only renders once the data is there. */
export function __Component__({ messages }: { messages?: Partial<__Component__Messages> }) {
  const { status, data, errorCode, locale, returnUrl } = useSurface(__const__);
  const t: __Component__Messages = { ...pickLocalized(__MESSAGES__, locale)!, ...messages };

  if (status === "loading") return <Shell><Skeleton /></Shell>;
  if (status !== "ready" || !data) {
    // upstream_error: your data source failed and the agent was told. refused: resolve said no; `errorReason` from
    // useSurface() is its SurfaceError code (e.g. "account_not_linked") if one deserves a message of its own.
    // Both send the user back to the chat.
    const upstream = errorCode === "upstream_error";
    const refused = errorCode === "refused";
    return (
      <Shell>
        <Card>
          <p className="font-medium">{status === "expired" ? t.expired : errorCode === "other_device" ? t.otherDevice : refused ? t.refused : upstream ? t.unavailable : t.loadError}</p>
          <p className="mt-1 text-sm text-muted-foreground">{refused ? t.refusedBody : upstream ? t.unavailableBody : t.askNewLink}</p>
          {(upstream || refused) && returnUrl && <a href={returnUrl} className={btn("outline", "mt-3 w-full")}>{t.backToChat}</a>}
        </Card>
      </Shell>
    );
  }
  return <Shell steps>{data.submitted ? <Done reference={data.submitted.reference} t={t} /> : <Steps data={data} t={t} />}</Shell>;
}

/** The steps. Answers live in state until each step is saved with its event, so going back never loses them. */
function Steps({ data, t }: { data: Data; t: __Component__Messages }) {
  const { emit, locale } = useSurface(__const__);
  const [details, setDetails] = useState(data.draft.details);
  const [choice, setChoice] = useState(data.draft.choice);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<null | { message: string; retry?: { label: string; onClick: () => void } }>(null);

  // TODO: leave out steps that don't apply to this user, e.g. __const__Steps.filter((s) => s !== "choice" || needsChoice).
  const path: Step[] = [...__const__Steps];
  const valid: Record<Step, boolean> = { details: details.trim().length > 0, choice: Boolean(choice), review: true };
  // How far the user may go: the furthest step saved, but never past a step whose answer is missing now
  // (they went back and changed something). Steps that dropped out of the path count by their place in the order.
  const saved = path.reduce((at, s, i) => (__const__Steps.indexOf(s) <= __const__Steps.indexOf(data.draft.step) ? i : at), 0);
  const firstMissing = path.findIndex((s) => !valid[s]);
  const reached = firstMissing === -1 ? saved : Math.min(saved, firstMissing);
  // Resumes there; Back and the phone's back button go to the step before.
  const nav = useSurfaceSteps(path, { initial: path[reached] });

  function go(to: Step) {
    setProblem(null);
    nav.go(to);
    window.scrollTo({ top: 0 });
  }

  /** Save this step with its event, then move on. Failures say why, and only offer "Try again" when it can work. */
  async function next() {
    setBusy(true);
    setProblem(null);
    try {
      if (nav.step === "details") await emit("details_saved", { details });
      if (nav.step === "choice") await emit("choice_saved", { choice: choice! });
      if (nav.step === "review") await emit("submitted", {});
      if (!nav.isLast) {
        nav.next();
        window.scrollTo({ top: 0 });
      }
    } catch (err) {
      // The server already told the agent; here we only tell the user.
      const e = err instanceof SurfaceActionError ? err : null;
      const known = e?.reason ? t.errors[e.reason] : undefined;
      const retryable = !e || e.retryable;
      setProblem({
        message: known ?? (!e || e.code === "network" ? t.offline : t.failed),
        retry: !known && retryable ? { label: t.tryAgain, onClick: () => void next() } : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepBar steps={path.map((s) => ({ key: s, label: t.steps[s] }))} index={nav.index} reached={reached} onSelect={go} locale={locale} disabled={busy} />

      {nav.step === "details" && (
        <Section title={t.detailsTitle}>
          <textarea
            aria-label={t.detailsTitle}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={500}
            placeholder={t.detailsPlaceholder}
            className="min-h-28 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </Section>
      )}

      {nav.step === "choice" && (
        <Section title={t.choiceTitle}>
          {data.options.map((o) => (
            <ChoiceCard key={o.id} type="radio" name="choice" checked={choice === o.id} onChange={() => setChoice(o.id)} title={o.label} />
          ))}
        </Section>
      )}

      {nav.step === "review" && (
        <Section title={t.reviewTitle}>
          <Summary title={t.steps.details} edit={t.edit} onEdit={() => go("details")}>{details}</Summary>
          <Summary title={t.steps.choice} edit={t.edit} onEdit={() => go("choice")}>
            {data.options.find((o) => o.id === choice)?.label}
          </Summary>
        </Section>
      )}

      <ActionBar
        back={nav.isFirst ? undefined : { label: t.back, onClick: nav.back }}
        primary={{ label: nav.isLast ? t.submit : t.next, onClick: () => void next(), disabled: !valid[nav.step], busy }}
        problem={problem}
      />
    </>
  );
}

/** After submitting: the outcome, and a way back. complete() tells the agent the user is done and closes the link. */
function Done({ reference, t }: { reference: string; t: __Component__Messages }) {
  const { complete, returnUrl } = useSurface(__const__);
  return (
    <Card className="border-success/40 bg-success/10">
      <p className="font-medium">{t.sent}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t.sentBody(reference)}</p>
      {returnUrl ? (
        <a href={returnUrl} onClick={() => void complete().catch(() => {})} className={btn("primary", "mt-3 w-full")}>{t.backToChat}</a>
      ) : (
        <button onClick={() => void complete().catch(() => {})} className={btn("primary", "mt-3 w-full")}>{t.finish}</button>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children}
    </section>
  );
}

function Summary({ title, edit, onEdit, children }: { title: string; edit: string; onEdit: () => void; children: ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <button type="button" onClick={onEdit} className="text-sm font-medium text-primary underline-offset-2 hover:underline">{edit}</button>
      </div>
      <div className="mt-1">{children}</div>
    </Card>
  );
}
