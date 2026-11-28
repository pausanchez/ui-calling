/**
 * The bottom bar of a step: Back and the step's one action, always within thumb reach, with the last
 * problem right above them. `problem.retry` shows "Try again"; leave it out when retrying can't help.
 *
 *   <ActionBar
 *     back={nav.isFirst ? undefined : { label: t.back, onClick: nav.back }}
 *     primary={{ label: nav.isLast ? t.submit : t.next, onClick: next, disabled: !valid, busy }}
 *     problem={problem}
 *   />
 */
export function ActionBar({
  back,
  primary,
  problem,
}: {
  back?: { label: string; onClick: () => void };
  primary: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean };
  problem?: { message: string; retry?: { label: string; onClick: () => void } } | null;
}) {
  const btn =
    "inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      {problem && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <span>{problem.message}</span>
          {problem.retry && (
            <button type="button" onClick={problem.retry.onClick} className="shrink-0 font-medium underline underline-offset-2">
              {problem.retry.label}
            </button>
          )}
        </div>
      )}
      <div className={`grid gap-2 ${back ? "grid-cols-[auto_1fr]" : ""}`}>
        {back && (
          <button type="button" onClick={back.onClick} disabled={primary.busy} className={`${btn} border border-border bg-card hover:bg-muted`}>
            {back.label}
          </button>
        )}
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled || primary.busy}
          aria-busy={primary.busy}
          className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`}
        >
          {primary.label}
        </button>
      </div>
    </div>
  );
}
