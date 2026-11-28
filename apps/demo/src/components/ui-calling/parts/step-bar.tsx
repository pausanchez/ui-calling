/**
 * Progress through a screen with several steps: one segment per step, the current one named.
 * Reached steps can be tapped to go back to them. Pair it with `useSurfaceSteps` from @ui-calling/react:
 *
 *   <StepBar steps={path.map((s) => ({ key: s, label: t.steps[s] }))} index={nav.index} reached={reached} onSelect={nav.go} locale={locale} />
 */
export function StepBar<K extends string>({
  steps,
  index,
  reached = index,
  onSelect,
  locale,
  disabled,
}: {
  steps: { key: K; label: string }[];
  index: number;
  /** The furthest step the user has saved; steps up to it can be tapped. */
  reached?: number;
  onSelect?: (key: K) => void;
  locale?: string;
  disabled?: boolean;
}) {
  const stepOf = locale?.startsWith("es") ? `Paso ${index + 1} de ${steps.length}` : `Step ${index + 1} of ${steps.length}`;
  return (
    <nav aria-label={stepOf} className="flex flex-col gap-2">
      <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              disabled={disabled || !onSelect || i > reached || i === index}
              onClick={() => onSelect?.(s.key)}
              aria-current={i === index ? "step" : undefined}
              aria-label={s.label}
              className="flex w-full flex-col gap-1 py-1 text-left disabled:cursor-default"
            >
              <span className={`h-1.5 rounded-full ${i <= index ? "bg-primary" : i <= reached ? "bg-primary/40" : "bg-border"}`} />
            </button>
          </li>
        ))}
      </ol>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground" aria-live="polite">
        {stepOf} · <span className="text-foreground">{steps[index]?.label}</span>
      </p>
    </nav>
  );
}
