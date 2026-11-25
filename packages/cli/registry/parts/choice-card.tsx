import type { ReactNode } from "react";

/**
 * One option as a full-width card: a radio for one-of-many (a refund method, a slot), a checkbox for
 * some-of-many (items to return). Put a quantity stepper or a reason in `children`; it shows when checked.
 *
 *   <ChoiceCard type="radio" name="refund" checked={refund === "store_credit"} onChange={() => setRefund("store_credit")}
 *     title={t.storeCredit} description={t.storeCreditHint} />
 */
export function ChoiceCard({
  type,
  name,
  checked,
  onChange,
  title,
  description,
  aside,
  disabled,
  note,
  children,
}: {
  type: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned detail, e.g. a price or "1 spot left". */
  aside?: ReactNode;
  disabled?: boolean;
  /** Why it's disabled, e.g. "Final sale". */
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border bg-card text-card-foreground transition-colors ${
        checked ? "border-primary ring-1 ring-primary" : "border-border"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <label className={`flex min-h-11 items-start gap-3 p-3 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
        <input
          type={type}
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{title}</span>
          {description && <span className="text-sm text-muted-foreground">{description}</span>}
          {note && <span className="mt-1 w-fit rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{note}</span>}
        </span>
        {aside && <span className="shrink-0 text-sm text-muted-foreground">{aside}</span>}
      </label>
      {checked && children && <div className="border-t border-border px-3 py-3">{children}</div>}
    </div>
  );
}
