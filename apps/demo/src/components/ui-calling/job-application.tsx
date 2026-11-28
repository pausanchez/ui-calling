import { useState, type ReactNode } from "react";
import { pickLocalized, type SurfaceData, type SurfaceReason } from "@ui-calling/core";
import { SurfaceActionError, useSurface, useSurfaceSteps } from "@ui-calling/react";
import { Card, Shell, Skeleton, btn } from "./parts/screen-kit";
import { ActionBar } from "./parts/action-bar";
import { ChoiceCard } from "./parts/choice-card";
import { PhotoPicker } from "./parts/photo-picker";
import { StepBar } from "./parts/step-bar";
import { DAYS, TIMES, jobApplication, jobApplicationSteps } from "./job-application.surface";

type Day = (typeof DAYS)[number];
type Time = (typeof TIMES)[number];

/** Every string on the screen. Add a language by adding a key; override strings with the `messages` prop.
 * Not exported: a file that only exports components keeps Fast Refresh working. */
const JOB_APPLICATION_MESSAGES = {
  en: {
    steps: { about: "You", availability: "Availability", document: "ID", review: "Send" },
    applyingFor: "Applying for",
    aboutTitle: "About you",
    name: "Full name",
    town: "Town where you live",
    availabilityTitle: "When can you work?",
    daysLabel: "Days",
    timesLabel: "Times of day",
    days: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" } as Record<Day, string>,
    times: { morning: "Morning", afternoon: "Afternoon", night: "Night" } as Record<Time, string>,
    timesHint: { morning: "6:00–14:00", afternoon: "14:00–22:00", night: "22:00–6:00" } as Record<Time, string>,
    documentTitle: "Your ID or work permit",
    documentHelp: "A clear photo of the front. Only the hiring team sees it.",
    reviewTitle: "Check and send",
    photos: (n: number) => (n === 1 ? "1 photo" : `${n} photos`),
    edit: "Edit",
    back: "Back",
    next: "Continue",
    submit: "Send application",
    sent: "Application sent",
    sentBody: (ref: string, by: string) => `Your reference is ${ref}. The hiring team will reply by ${by}.`,
    saved: "Your progress is saved: you can stop and come back with the same link.",
    backToChat: "Back to chat",
    finish: "Finish",
    offline: "We couldn't reach the server. Check your connection and try again.",
    failed: "That didn't go through. Your assistant already knows.",
    tryAgain: "Try again",
    // One message per reason the contract declares.
    errors: { incomplete: "A step is missing. Go back and fill it in.", unknown_photo: "Upload the photo again." } satisfies Record<Reason, string>,
    unavailable: "This page isn't available right now",
    unavailableBody: "Your assistant already knows and will follow up in the chat.",
    refused: "This job isn't open any more",
    refusedBody: "Go back to the chat: your assistant can show you other openings.",
    expired: "This link has expired",
    otherDevice: "This link was already opened on another device",
    loadError: "We couldn't load this page",
    askNewLink: "Ask your assistant for a new link. Your progress is saved.",
  },
  es: {
    steps: { about: "Tú", availability: "Horario", document: "DNI", review: "Enviar" },
    applyingFor: "Te inscribes a",
    aboutTitle: "Sobre ti",
    name: "Nombre y apellidos",
    town: "Población donde vives",
    availabilityTitle: "¿Cuándo puedes trabajar?",
    daysLabel: "Días",
    timesLabel: "Franjas",
    days: { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" } as Record<Day, string>,
    times: { morning: "Mañana", afternoon: "Tarde", night: "Noche" } as Record<Time, string>,
    timesHint: { morning: "6:00–14:00", afternoon: "14:00–22:00", night: "22:00–6:00" } as Record<Time, string>,
    documentTitle: "Tu DNI, NIE o permiso de trabajo",
    documentHelp: "Una foto nítida de la parte delantera. Solo la ve el equipo de selección.",
    reviewTitle: "Revisa y envía",
    photos: (n: number) => (n === 1 ? "1 foto" : `${n} fotos`),
    edit: "Cambiar",
    back: "Atrás",
    next: "Continuar",
    submit: "Enviar candidatura",
    sent: "Candidatura enviada",
    sentBody: (ref: string, by: string) => `Tu referencia es ${ref}. El equipo de selección te responderá antes del ${by}.`,
    saved: "Lo que rellenas se guarda: puedes parar y volver con el mismo enlace.",
    backToChat: "Volver al chat",
    finish: "Terminar",
    offline: "No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.",
    failed: "No se ha podido completar. Tu asistente ya lo sabe.",
    tryAgain: "Reintentar",
    errors: { incomplete: "Falta un paso. Vuelve atrás y rellénalo.", unknown_photo: "Vuelve a subir la foto." } satisfies Record<Reason, string>,
    unavailable: "Esta página no está disponible ahora mismo",
    unavailableBody: "Tu asistente ya lo sabe y te escribirá por el chat.",
    refused: "Esta oferta ya no está abierta",
    refusedBody: "Vuelve al chat: tu asistente te enseña otras ofertas.",
    expired: "Este enlace ha caducado",
    otherDevice: "Este enlace ya se abrió en otro dispositivo",
    loadError: "No hemos podido cargar esta página",
    askNewLink: "Pídele un enlace nuevo a tu asistente. Lo que rellenaste está guardado.",
  },
};

export type JobApplicationMessages = (typeof JOB_APPLICATION_MESSAGES)["en"];
type Data = SurfaceData<typeof jobApplication>;
type Reason = SurfaceReason<typeof jobApplication>;
type Step = (typeof jobApplicationSteps)[number];

/** The screen's states. The steps live in <Steps>, which only renders once the data is there. */
export function JobApplication({ messages }: { messages?: Partial<JobApplicationMessages> }) {
  const { status, data, errorCode, locale, returnUrl } = useSurface(jobApplication);
  const t: JobApplicationMessages = { ...pickLocalized(JOB_APPLICATION_MESSAGES, locale)!, ...messages };

  if (status === "loading") return <Shell><Skeleton /></Shell>;
  if (status !== "ready" || !data) {
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
  return <Shell steps>{data.submitted ? <Done data={data} t={t} /> : <Steps data={data} t={t} />}</Shell>;
}

/** The steps. Answers live in state until each step is saved with its event, so going back never loses them. */
function Steps({ data, t }: { data: Data; t: JobApplicationMessages }) {
  const { emit, locale, upload, removeFile, fileUrl } = useSurface(jobApplication);
  const [name, setName] = useState(data.draft.name);
  const [town, setTown] = useState(data.draft.town);
  const [days, setDays] = useState<Day[]>(data.draft.days);
  const [times, setTimes] = useState<Time[]>(data.draft.times);
  // The draft's photos, or what this link already uploaded if the step wasn't saved yet.
  const [photos, setPhotos] = useState(data.draft.document.length ? data.draft.document : data.uploaded);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<null | { message: string; retry?: { label: string; onClick: () => void } }>(null);

  const path: Step[] = [...jobApplicationSteps];
  const valid: Record<Step, boolean> = {
    about: name.trim().length >= 2 && town.trim().length >= 2,
    availability: days.length > 0 && times.length > 0,
    document: photos.length > 0,
    review: true,
  };
  // Resume at the furthest step saved, but never past one whose answer is missing now.
  const saved = jobApplicationSteps.indexOf(data.draft.step);
  const firstMissing = path.findIndex((s) => !valid[s]);
  const reached = firstMissing === -1 ? saved : Math.min(saved, firstMissing);
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
      if (nav.step === "about") await emit("about_saved", { name: name.trim(), town: town.trim() });
      if (nav.step === "availability") await emit("availability_saved", { days, times });
      if (nav.step === "document") await emit("document_added", { files: photos.map((p) => p.id) });
      if (nav.step === "review") await emit("application_sent", {});
      if (!nav.isLast) {
        nav.next();
        window.scrollTo({ top: 0 });
      }
    } catch (err) {
      const e = err instanceof SurfaceActionError ? err : null;
      const known = e?.reason ? (t.errors as Record<string, string | undefined>)[e.reason] : undefined;
      setProblem({
        message: known ?? (!e || e.code === "network" ? t.offline : t.failed),
        retry: !known && (!e || e.retryable) ? { label: t.tryAgain, onClick: () => void next() } : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const field = "h-12 w-full rounded-md border border-border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring";

  return (
    <>
      <StepBar steps={path.map((s) => ({ key: s, label: t.steps[s] }))} index={nav.index} reached={reached} onSelect={go} locale={locale} disabled={busy} />

      {nav.step === "about" && (
        <Section title={t.aboutTitle}>
          <Card className="bg-muted/40">
            <p className="text-sm text-muted-foreground">{t.applyingFor}</p>
            <p className="font-medium">{data.job.title}</p>
            <p className="text-sm text-muted-foreground">{data.job.location} · {data.job.pay}</p>
          </Card>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t.name}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t.town}
            <input value={town} onChange={(e) => setTown(e.target.value)} maxLength={60} autoComplete="address-level2" className={field} />
          </label>
          <p className="text-sm text-muted-foreground">{t.saved}</p>
        </Section>
      )}

      {nav.step === "availability" && (
        <Section title={t.availabilityTitle}>
          <p className="text-sm font-medium">{t.daysLabel}</p>
          <div className="grid grid-cols-4 gap-2">
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days.includes(d)}
                onClick={() => setDays(toggle(days, d))}
                className={`h-12 rounded-md border text-sm font-medium ${days.includes(d) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}
              >
                {t.days[d]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm font-medium">{t.timesLabel}</p>
          {TIMES.map((time) => (
            <ChoiceCard key={time} type="checkbox" checked={times.includes(time)} onChange={() => setTimes(toggle(times, time))} title={t.times[time]} aside={t.timesHint[time]} />
          ))}
        </Section>
      )}

      {nav.step === "document" && (
        <Section title={t.documentTitle}>
          <p className="text-sm text-muted-foreground">{t.documentHelp}</p>
          <PhotoPicker
            slot={jobApplication.files!.document}
            photos={photos}
            onChange={setPhotos}
            upload={(f) => upload("document", f)}
            remove={removeFile}
            fileUrl={fileUrl}
            locale={locale}
          />
        </Section>
      )}

      {nav.step === "review" && (
        <Section title={t.reviewTitle}>
          <Summary title={t.aboutTitle} edit={t.edit} onEdit={() => go("about")}>
            {name} · {town}
          </Summary>
          <Summary title={t.steps.availability} edit={t.edit} onEdit={() => go("availability")}>
            {DAYS.filter((d) => days.includes(d)).map((d) => t.days[d]).join(", ")} · {times.map((x) => t.times[x]).join(", ")}
          </Summary>
          <Summary title={t.steps.document} edit={t.edit} onEdit={() => go("document")}>
            {t.photos(photos.length)}
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

/** After sending: the reference, and a way back. complete() tells the agent the candidate is done and closes the link. */
function Done({ data, t }: { data: Data; t: JobApplicationMessages }) {
  const { complete, returnUrl, locale } = useSurface(jobApplication);
  const by = new Date(`${data.submitted!.interviewBy}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  return (
    <Card className="border-success/40 bg-success/10">
      <p className="font-medium">{t.sent}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t.sentBody(data.submitted!.reference, by)}</p>
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
