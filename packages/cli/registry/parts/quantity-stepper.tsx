/**
 * Minus, the number, plus: for "how many", with 44px targets.
 *
 *   <QuantityStepper value={qty} min={1} max={item.qty} onChange={setQty} label={item.name} locale={locale} />
 */
export function QuantityStepper({
  value,
  min = 1,
  max,
  onChange,
  label,
  locale,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  /** What is being counted, for screen readers. */
  label: string;
  locale?: string;
}) {
  const es = locale?.startsWith("es");
  const btn =
    "grid size-11 place-items-center rounded-md border border-border bg-card text-lg hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={es ? `Quitar uno: ${label}` : `One less: ${label}`}>
        −
      </button>
      <span className="min-w-6 text-center font-medium tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={es ? `Añadir uno: ${label}` : `One more: ${label}`}>
        +
      </button>
      <span className="text-sm text-muted-foreground">{es ? `de ${max}` : `of ${max}`}</span>
    </div>
  );
}
