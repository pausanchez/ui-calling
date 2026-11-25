import { useEffect, useRef, useState, type ReactNode } from "react";
import { pickLocalized, type SurfaceData } from "@ui-calling/core";
import { SurfaceActionError, useSurface } from "@ui-calling/react";
import { NEEDS_PHOTOS, RETURN_REASONS, RETURN_STEPS, orderReturn } from "./order-return.surface";

type Return = SurfaceData<typeof orderReturn>;
type Step = (typeof RETURN_STEPS)[number];
type Reason = (typeof RETURN_REASONS)[number];
type Line = { sku: string; qty: number; reason: Reason | null; details: string };
type Refund = "original_payment" | "store_credit";

/** Every string on the screen. Add a language by adding a key; override strings with the `messages` prop.
 * Not exported: a file that only exports components keeps Fast Refresh working. */
const ORDER_RETURN_MESSAGES = {
  en: {
    title: "Return items",
    order: (id: string, day: string) => `Order ${id} · delivered ${day}`,
    steps: { items: "Items", reasons: "Reason", photos: "Photos", pickup: "Pickup", review: "Review" } as Record<Step, string>,
    stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
    itemsTitle: "What are you returning?",
    finalSale: "Final sale, can't be returned",
    quantity: "Quantity",
    less: "One less",
    more: "One more",
    reasonsTitle: "Why are you returning them?",
    reasonLabel: "Reason",
    choose: "Choose a reason",
    reasons: {
      damaged: "Arrived damaged",
      wrong_item: "Wrong item",
      not_as_described: "Not as described",
      no_longer_needed: "No longer needed",
      other: "Something else",
    } as Record<Reason, string>,
    detailsOptional: "Anything to add? (optional)",
    detailsRequired: "Tell us what happened",
    photosTitle: "Add photos of the problem",
    photosHelp: "Show the damage or the label of the wrong item. Up to 5 photos.",
    addPhotos: "Add photos",
    uploading: "Uploading…",
    remove: (name: string) => `Remove ${name}`,
    photosNeeded: "Add at least one photo to continue.",
    pickupTitle: "Refund and pickup",
    refundLabel: "Refund to",
    refunds: { original_payment: "Original payment method", store_credit: "Store credit" } as Record<Refund, string>,
    refundHelp: { original_payment: "3–5 days after pickup", store_credit: "Right after pickup" } as Record<Refund, string>,
    pickupLabel: "Courier pickup at",
    full: "Full",
    spotsLeft: (n: number) => (n === 1 ? "1 spot left" : `${n} spots left`),
    reviewTitle: "Check and send",
    edit: "Edit",
    photosCount: (n: number) => (n === 1 ? "1 photo" : `${n} photos`),
    refundTotal: "Refund",
    back: "Back",
    next: "Continue",
    submit: "Send return",
    submitted: "Return sent",
    returnNumber: (id: string) => `Return ${id}`,
    submittedBody: (when: string) => `A courier will pick it up on ${when}. Keep the items packed and the box closed.`,
    assistantKnows: "Your assistant already knows. You can go back to the chat.",
    backToChat: "Back to chat",
    finish: "Finish",
    errors: {
      file_too_large: "That photo is too big. Photos can be up to 8 MB.",
      file_type_not_allowed: "That file isn't a photo.",
      too_many_files: "You can add up to 5 photos.",
      photos_required: "Add at least one photo to continue.",
      pickup_slot_full: "That pickup slot just filled up. Pick another one.",
      item_not_returnable: "One of those items can't be returned.",
    } as Record<string, string>,
    actionFailed: "That didn't go through",
    actionFailedBody: "Your assistant already knows. You can try again or go back to the chat.",
    offline: "We couldn't reach the server. Check your connection and try again.",
    tryAgain: "Try again",
    unavailable: "Returns aren't available right now",
    unavailableBody: "Your assistant already knows and will follow up in the chat.",
    expired: "This link has expired",
    loadError: "We couldn't load this page",
    askNewLink: "Ask your assistant for a new link.",
  },
  es: {
    title: "Devolver artículos",
    order: (id: string, day: string) => `Pedido ${id} · entregado el ${day}`,
    steps: { items: "Artículos", reasons: "Motivo", photos: "Fotos", pickup: "Recogida", review: "Revisar" },
    stepOf: (n: number, total: number) => `Paso ${n} de ${total}`,
    itemsTitle: "¿Qué quieres devolver?",
    finalSale: "Sin devolución",
    quantity: "Cantidad",
    less: "Uno menos",
    more: "Uno más",
    reasonsTitle: "¿Por qué los devuelves?",
    reasonLabel: "Motivo",
    choose: "Elige un motivo",
    reasons: {
      damaged: "Llegó dañado",
      wrong_item: "No es lo que pedí",
      not_as_described: "No es como se describía",
      no_longer_needed: "Ya no lo necesito",
      other: "Otro motivo",
    },
    detailsOptional: "¿Algo que añadir? (opcional)",
    detailsRequired: "Cuéntanos qué ha pasado",
    photosTitle: "Añade fotos del problema",
    photosHelp: "Muestra el daño o la etiqueta del artículo equivocado. Hasta 5 fotos.",
    addPhotos: "Añadir fotos",
    uploading: "Subiendo…",
    remove: (name: string) => `Quitar ${name}`,
    photosNeeded: "Añade al menos una foto para continuar.",
    pickupTitle: "Reembolso y recogida",
    refundLabel: "Reembolsar en",
    refunds: { original_payment: "Método de pago original", store_credit: "Saldo en la tienda" },
    refundHelp: { original_payment: "3–5 días después de la recogida", store_credit: "Justo después de la recogida" },
    pickupLabel: "Recogida por mensajero en",
    full: "Completo",
    spotsLeft: (n: number) => (n === 1 ? "Queda 1 plaza" : `Quedan ${n} plazas`),
    reviewTitle: "Revisa y envía",
    edit: "Editar",
    photosCount: (n: number) => (n === 1 ? "1 foto" : `${n} fotos`),
    refundTotal: "Reembolso",
    back: "Atrás",
    next: "Continuar",
    submit: "Enviar devolución",
    submitted: "Devolución enviada",
    returnNumber: (id: string) => `Devolución ${id}`,
    submittedBody: (when: string) => `Un mensajero la recogerá el ${when}. Ten los artículos embalados y la caja cerrada.`,
    assistantKnows: "Tu asistente ya lo sabe. Puedes volver al chat.",
    backToChat: "Volver al chat",
    finish: "Terminar",
    errors: {
      file_too_large: "Esa foto es demasiado grande. Las fotos pueden ocupar hasta 8 MB.",
      file_type_not_allowed: "Ese archivo no es una foto.",
      too_many_files: "Puedes añadir hasta 5 fotos.",
      photos_required: "Añade al menos una foto para continuar.",
      pickup_slot_full: "Esa franja de recogida se acaba de completar. Elige otra.",
      item_not_returnable: "Uno de esos artículos no se puede devolver.",
    },
    actionFailed: "No se ha podido completar",
    actionFailedBody: "Tu asistente ya lo sabe. Puedes intentarlo de nuevo o volver al chat.",
    offline: "No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.",
    tryAgain: "Reintentar",
    unavailable: "Las devoluciones no están disponibles ahora mismo",
    unavailableBody: "Tu asistente ya lo sabe y te escribirá por el chat.",
    expired: "Este enlace ha caducado",
    loadError: "No hemos podido cargar esta página",
    askNewLink: "Pídele un enlace nuevo a tu asistente.",
  },
};

export type OrderReturnMessages = (typeof ORDER_RETURN_MESSAGES)["en"];

const PHOTOS = orderReturn.files!.photos;

export function OrderReturn({ messages }: { messages?: Partial<OrderReturnMessages> }) {
  const s = useSurface(orderReturn);
  const t: OrderReturnMessages = { ...pickLocalized(ORDER_RETURN_MESSAGES, s.locale)!, ...messages };

  if (s.status === "loading") return <Shell><Skeleton /></Shell>;
  if (s.status !== "ready" || !s.data) {
    // upstream_error: the data source failed and the agent was told, so send the user back to the chat.
    const upstream = s.errorCode === "upstream_error";
    return (
      <Shell>
        <Card>
          <p className="font-medium">{s.status === "expired" ? t.expired : upstream ? t.unavailable : t.loadError}</p>
          <p className="mt-1 text-sm text-muted-foreground">{upstream ? t.unavailableBody : t.askNewLink}</p>
          {upstream && s.returnUrl && <a href={s.returnUrl} className={btn("outline", "mt-3 w-full")}>{t.backToChat}</a>}
        </Card>
      </Shell>
    );
  }
  return s.data.submitted ? <Submitted data={s.data} t={t} /> : <Wizard data={s.data} t={t} />;
}

/** The five steps. Answers live here until each step is saved with its event, so going back never loses them. */
function Wizard({ data, t }: { data: Return; t: OrderReturnMessages }) {
  const { emit, upload, removeFile, fileUrl, reload, locale } = useSurface(orderReturn);
  const [lines, setLines] = useState<Line[]>(data.draft.lines);
  const [photos, setPhotos] = useState(data.uploaded);
  const [uploading, setUploading] = useState(0);
  const [refund, setRefund] = useState<Refund | null>(data.draft.refund);
  const [pickup, setPickup] = useState(data.draft.pickup);
  // Resume where the user stopped: the furthest step they reached.
  const [step, setStep] = useState<Step>(data.draft.step);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<null | { message: string; retry?: () => void }>(null);
  const top = useRef<HTMLDivElement>(null);

  const needsPhotos = lines.some((l) => l.reason && NEEDS_PHOTOS.includes(l.reason));
  // The photos step only exists when a reason calls for it.
  const path = RETURN_STEPS.filter((s) => s !== "photos" || needsPhotos);
  const at = path.indexOf(step) === -1 ? path.indexOf("pickup") : path.indexOf(step);
  const reached = Math.max(at, path.indexOf(data.draft.step));
  const item = (sku: string) => data.items.find((i) => i.sku === sku)!;
  const day = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const money = (n: number) => n.toLocaleString(locale, { style: "currency", currency: data.currency });
  const total = lines.reduce((sum, l) => sum + l.qty * item(l.sku).price, 0);

  // The phone's back button moves between steps instead of leaving the screen.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { returnStep?: Step } | null)?.returnStep;
      if (s) setStep(s);
    };
    // Opened fresh on a later step (resuming a draft): add the earlier steps behind it, so Back goes
    // to them instead of leaving. A reload already has them in its history.
    if (!(history.state as { returnStep?: Step } | null)?.returnStep) {
      history.replaceState({ ...history.state, returnStep: path[0] }, "");
      for (const s of path.slice(1, at + 1)) history.pushState({ ...history.state, returnStep: s }, "");
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(to: Step, push = true) {
    setProblem(null);
    setStep(to);
    if (push) history.pushState({ ...history.state, returnStep: to }, "");
    top.current?.scrollIntoView({ block: "start" });
  }

  const valid: Record<Step, boolean> = {
    items: lines.length > 0,
    reasons: lines.every((l) => l.reason && (l.reason !== "other" || l.details.trim())),
    photos: !needsPhotos || photos.length > 0,
    pickup: Boolean(refund && pickup),
    review: true,
  };

  /** Save this step with its event, then move on. Failures say why, and only offer a retry when it can work. */
  async function next() {
    const current = path[at];
    const save = async () => {
      if (current === "items") await emit("items_chosen", { lines: lines.map(({ sku, qty }) => ({ sku, qty })) });
      if (current === "reasons") await emit("reasons_given", { lines: lines.map((l) => ({ sku: l.sku, reason: l.reason!, details: l.details.trim() })) });
      if (current === "photos") await emit("photos_added", { photos: photos.map((p) => p.id) });
      if (current === "pickup") await emit("pickup_chosen", { refund: refund!, date: pickup!.date, window: pickup!.window });
      if (current === "review") await emit("return_submitted", {});
    };
    setBusy(true);
    setProblem(null);
    try {
      await save();
      if (current !== "review") go(path[at + 1]);
    } catch (err) {
      const e = err instanceof SurfaceActionError ? err : null;
      const known = e?.reason ? t.errors[e.reason] : undefined;
      const offline = !e || e.code === "network";
      const retryable = !e || e.retryable;
      setProblem({
        message: known ?? (offline ? t.offline : t.actionFailedBody),
        retry: !known && retryable ? () => void next() : undefined,
      });
      // A full slot means the list on screen is out of date.
      if (e?.reason === "pickup_slot_full") {
        setPickup(null);
        void reload().catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setProblem(null);
    for (const file of Array.from(files)) {
      if (photos.length + uploading >= (PHOTOS.maxFiles ?? 1)) return setProblem({ message: t.errors.too_many_files });
      // Checked here too, so the user doesn't wait for an upload the server would refuse.
      if (!file.type.startsWith("image/")) {
        setProblem({ message: t.errors.file_type_not_allowed });
        continue;
      }
      if (file.size > PHOTOS.maxBytes) {
        setProblem({ message: t.errors.file_too_large });
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const ref = await upload("photos", file);
        setPhotos((p) => [...p, { id: ref.id, name: ref.name }]);
      } catch (err) {
        const reason = err instanceof SurfaceActionError ? err.reason : undefined;
        setProblem({ message: (reason && t.errors[reason]) || t.offline });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function dropPhoto(id: string) {
    setPhotos((p) => p.filter((x) => x.id !== id));
    await removeFile(id).catch(() => {});
  }

  const toggle = (sku: string) =>
    setLines((ls) => (ls.some((l) => l.sku === sku) ? ls.filter((l) => l.sku !== sku) : [...ls, { sku, qty: 1, reason: null, details: "" }]));
  const update = (sku: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.sku === sku ? { ...l, ...patch } : l)));

  return (
    <Shell>
      <div ref={top} className="scroll-mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.order(data.orderId, day(data.deliveredOn))}</p>
      </div>

      <nav aria-label={t.stepOf(at + 1, path.length)}>
        <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${path.length}, minmax(0, 1fr))` }}>
          {path.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                disabled={i > reached || busy}
                onClick={() => go(s)}
                aria-current={i === at ? "step" : undefined}
                aria-label={t.steps[s]}
                className="flex w-full flex-col gap-1 text-left disabled:cursor-default"
              >
                <span className={`h-1.5 rounded-full ${i <= at ? "bg-primary" : i <= reached ? "bg-primary/40" : "bg-border"}`} />
                <span className={`truncate text-xs ${i === at ? "font-medium text-foreground" : "text-muted-foreground"}`}>{t.steps[s]}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="sr-only" aria-live="polite">{t.stepOf(at + 1, path.length)}: {t.steps[path[at]]}</p>
      </nav>

      {problem && (
        <Card role="alert" className="border-destructive/40 bg-destructive/10">
          <p className="font-medium">{t.actionFailed}</p>
          <p className="mt-1 text-sm text-muted-foreground">{problem.message}</p>
          {problem.retry && <button onClick={problem.retry} disabled={busy} className={btn("primary", "mt-3 w-full")}>{t.tryAgain}</button>}
        </Card>
      )}

      {path[at] === "items" && (
        <Section title={t.itemsTitle}>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {data.items.map((i) => {
              const line = lines.find((l) => l.sku === i.sku);
              return (
                <li key={i.sku} className="p-4">
                  <label className={`flex items-start gap-3 ${i.returnable ? "cursor-pointer" : "opacity-60"}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(line)}
                      disabled={!i.returnable}
                      onChange={() => toggle(i.sku)}
                      className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{i.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {i.returnable ? `${i.qty} × ${money(i.price)}` : t.finalSale}
                      </span>
                    </span>
                  </label>
                  {line && i.qty > 1 && (
                    <div className="mt-3 flex items-center justify-between pl-8">
                      <span className="text-sm text-muted-foreground">{t.quantity}</span>
                      <div className="flex items-center gap-3">
                        <button type="button" aria-label={t.less} disabled={line.qty <= 1} onClick={() => update(i.sku, { qty: line.qty - 1 })} className={btn("outline", "size-11 px-0")}>−</button>
                        <span className="w-4 text-center tabular-nums" aria-live="polite">{line.qty}</span>
                        <button type="button" aria-label={t.more} disabled={line.qty >= i.qty} onClick={() => update(i.sku, { qty: line.qty + 1 })} className={btn("outline", "size-11 px-0")}>+</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {path[at] === "reasons" && (
        <Section title={t.reasonsTitle}>
          {lines.map((l) => (
            <Card key={l.sku}>
              <p className="font-medium">{l.qty > 1 ? `${l.qty} × ` : ""}{item(l.sku).name}</p>
              <label className="mt-3 block text-sm">
                <span className="text-muted-foreground">{t.reasonLabel}</span>
                <select
                  value={l.reason ?? ""}
                  onChange={(e) => update(l.sku, { reason: e.target.value as Reason })}
                  className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" disabled>{t.choose}</option>
                  {RETURN_REASONS.map((r) => <option key={r} value={r}>{t.reasons[r]}</option>)}
                </select>
              </label>
              {l.reason && (
                <textarea
                  aria-label={l.reason === "other" ? t.detailsRequired : t.detailsOptional}
                  value={l.details}
                  onChange={(e) => update(l.sku, { details: e.target.value })}
                  maxLength={300}
                  placeholder={l.reason === "other" ? t.detailsRequired : t.detailsOptional}
                  className="mt-3 min-h-20 w-full rounded-md border border-border bg-background p-3 text-base outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </Card>
          ))}
        </Section>
      )}

      {path[at] === "photos" && (
        <Section title={t.photosTitle}>
          <p className="-mt-1 text-sm text-muted-foreground">{t.photosHelp}</p>
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <li key={p.id} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
                <img src={fileUrl(p.id)} alt={p.name} className="size-full object-cover" />
                <button
                  type="button"
                  aria-label={t.remove(p.name)}
                  onClick={() => void dropPhoto(p.id)}
                  className="absolute right-1 top-1 grid size-8 place-items-center rounded-full bg-background/90 text-lg leading-none shadow"
                >
                  ×
                </button>
              </li>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <li key={`u${i}`} className="grid aspect-square animate-pulse place-items-center rounded-md bg-muted text-xs text-muted-foreground">{t.uploading}</li>
            ))}
          </ul>
          {photos.length + uploading < (PHOTOS.maxFiles ?? 1) && (
            <label className={btn("outline", "w-full cursor-pointer")}>
              {t.addPhotos}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
          {!photos.length && <p className="text-sm text-muted-foreground">{t.photosNeeded}</p>}
        </Section>
      )}

      {path[at] === "pickup" && (
        <Section title={t.pickupTitle}>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm text-muted-foreground">{t.refundLabel}</legend>
            {(["original_payment", "store_credit"] as const).map((r) => (
              <Choice key={r} name="refund" checked={refund === r} onChange={() => setRefund(r)} title={t.refunds[r]} detail={t.refundHelp[r]} />
            ))}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm text-muted-foreground">{t.pickupLabel} {data.address}</legend>
            {data.pickupOptions.map((o) => (
              <Choice
                key={o.date + o.window}
                name="pickup"
                disabled={o.spotsLeft <= 0}
                checked={pickup?.date === o.date && pickup.window === o.window}
                onChange={() => setPickup({ date: o.date, window: o.window })}
                title={<span className="first-letter:uppercase">{day(o.date)}</span>}
                detail={`${o.window} · ${o.spotsLeft > 0 ? t.spotsLeft(o.spotsLeft) : t.full}`}
              />
            ))}
          </fieldset>
        </Section>
      )}

      {path[at] === "review" && (
        <Section title={t.reviewTitle}>
          <Card>
            <Summary title={t.steps.items} onEdit={() => go("items")} t={t}>
              {lines.map((l) => (
                <p key={l.sku}>{l.qty} × {item(l.sku).name} · <span className="text-muted-foreground">{l.reason && t.reasons[l.reason]}</span></p>
              ))}
            </Summary>
            {needsPhotos && (
              <Summary title={t.steps.photos} onEdit={() => go("photos")} t={t}>
                <p>{t.photosCount(photos.length)}</p>
              </Summary>
            )}
            <Summary title={t.steps.pickup} onEdit={() => go("pickup")} t={t}>
              <p className="first-letter:uppercase">{pickup && `${day(pickup.date)}, ${pickup.window}`}</p>
              <p className="text-muted-foreground">{refund && t.refunds[refund]}</p>
            </Summary>
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{t.refundTotal}</span>
              <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
            </div>
          </Card>
        </Section>
      )}

      <div className={`sticky bottom-0 -mx-4 mt-auto grid gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur ${at > 0 ? "grid-cols-[auto_1fr]" : ""}`}>
        {at > 0 && (
          <button type="button" onClick={() => history.back()} disabled={busy} className={btn("outline")}>
            {t.back}
          </button>
        )}
        <button type="button" onClick={() => void next()} disabled={!valid[path[at]] || busy || uploading > 0} className={btn("primary")}>
          {path[at] === "review" ? t.submit : t.next}
        </button>
      </div>
    </Shell>
  );
}

function Submitted({ data, t }: { data: Return; t: OrderReturnMessages }) {
  const { complete, returnUrl, locale } = useSurface(orderReturn);
  const s = data.submitted!;
  const when = `${new Date(s.pickup.date + "T12:00:00").toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}, ${s.pickup.window}`;
  return (
    <Shell>
      <Card className="border-success/40 bg-success/10">
        <p className="text-sm text-muted-foreground">{t.returnNumber(s.returnId)}</p>
        <p className="mt-0.5 text-xl font-semibold">{t.submitted}</p>
        <p className="mt-2 text-sm">{t.submittedBody(when)}</p>
        <p className="mt-2 text-sm">
          {t.refundTotal}: <span className="font-medium tabular-nums">{s.refundAmount.toLocaleString(locale, { style: "currency", currency: data.currency })}</span> · {t.refunds[s.refund]}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{t.assistantKnows}</p>
        {/* complete() closes the link: the return is filed, there's nothing left to do here. */}
        {returnUrl ? (
          <a href={returnUrl} onClick={() => void complete().catch(() => {})} className={btn("primary", "mt-3 w-full")}>{t.backToChat}</a>
        ) : (
          <button onClick={() => void complete().catch(() => {})} className={btn("primary", "mt-3 w-full")}>{t.finish}</button>
        )}
      </Card>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Summary({ title, onEdit, t, children }: { title: string; onEdit: () => void; t: OrderReturnMessages; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-3 mb-3 text-sm last:mb-0">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        {children}
      </div>
      <button type="button" onClick={onEdit} className="h-11 shrink-0 px-2 text-sm font-medium text-primary">{t.edit}</button>
    </div>
  );
}

function Choice(props: { name: string; checked: boolean; disabled?: boolean; onChange: () => void; title: ReactNode; detail: string }) {
  return (
    <label
      className={`flex min-h-11 items-center gap-3 rounded-lg border p-3 ${props.checked ? "border-primary bg-accent" : "border-border bg-card"} ${
        props.disabled ? "opacity-50" : "cursor-pointer"
      }`}
    >
      <input type="radio" name={props.name} checked={props.checked} disabled={props.disabled} onChange={props.onChange} className="size-5 shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0">
        <span className="block font-medium">{props.title}</span>
        <span className="block text-sm text-muted-foreground">{props.detail}</span>
      </span>
    </label>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-6">{children}</div>
    </main>
  );
}

function Card({ children, className = "", role }: { children: ReactNode; className?: string; role?: string }) {
  return <section role={role} className={`rounded-lg border border-border bg-card p-4 text-card-foreground ${className}`}>{children}</section>;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-10 w-1/2 rounded-md bg-muted" />
      <div className="h-3 rounded-full bg-muted" />
      <div className="h-48 rounded-lg bg-muted" />
    </div>
  );
}

function btn(variant: "primary" | "outline", extra = "") {
  const base =
    "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-card hover:bg-muted",
  }[variant];
  return `${base} ${v} ${extra}`;
}
