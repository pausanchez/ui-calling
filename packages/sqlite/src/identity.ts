import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type VerifyResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: "no_code" | "expired" | "wrong_code" | "locked"; attemptsLeft?: number };

/**
 * Who a chat user is: links between a session subject (e.g. a WhatsApp BSUID) and your customer or employee ID,
 * and the one-time codes that prove it. The security-critical half of the link-account screen, in tables next to
 * ui-calling's own (`ui_links`, `ui_codes`, `ui_code_attempts`).
 *
 *   const identity = sqliteIdentity(store);
 *   identity.customerFor(ctx.subject)               // undefined until linked
 *   const code = identity.startVerification(ctx.subject, customer.id);   // send it by email or SMS
 *   identity.verify(ctx.subject, typedCode)         // links the subject on success
 *
 * Wrong codes are counted per customer, not per link or chat: opening a new link doesn't reset them.
 * Codes are stored hashed and compared in constant time.
 */
export function sqliteIdentity(
  store: { db: DatabaseSync },
  opts: {
    /** How long a code works. Default 10 minutes. */
    codeTtlMs?: number;
    /** Wrong codes before the customer is locked out. Default 5. */
    maxAttempts?: number;
    /** How long the lock lasts. Default 15 minutes. */
    lockMs?: number;
    /** Digits in a code. Default 6. */
    digits?: number;
  } = {},
) {
  const codeTtlMs = opts.codeTtlMs ?? 10 * 60_000;
  const maxAttempts = opts.maxAttempts ?? 5;
  const lockMs = opts.lockMs ?? 15 * 60_000;
  const digits = opts.digits ?? 6;
  // Tables and statements on first use, not at import: `next build` imports route modules and would otherwise
  // open (and create) the production database.
  let prepared: ReturnType<typeof prepare> | undefined;
  const prepare = () => {
    const { db } = store;
    db.exec(`
      CREATE TABLE IF NOT EXISTS ui_links (subject TEXT PRIMARY KEY, customer_id TEXT NOT NULL, linked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ui_codes (subject TEXT PRIMARY KEY, customer_id TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ui_code_attempts (customer_id TEXT PRIMARY KEY, failures INTEGER NOT NULL, locked_until INTEGER NOT NULL);
    `);
    return {
      link: db.prepare("INSERT INTO ui_links (subject, customer_id, linked_at) VALUES (?, ?, ?) ON CONFLICT(subject) DO UPDATE SET customer_id = excluded.customer_id, linked_at = excluded.linked_at"),
      linkOf: db.prepare("SELECT customer_id FROM ui_links WHERE subject = ?"),
      unlink: db.prepare("DELETE FROM ui_links WHERE subject = ?"),
      putCode: db.prepare("INSERT INTO ui_codes (subject, customer_id, code_hash, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(subject) DO UPDATE SET customer_id = excluded.customer_id, code_hash = excluded.code_hash, expires_at = excluded.expires_at"),
      codeOf: db.prepare("SELECT customer_id, code_hash, expires_at FROM ui_codes WHERE subject = ?"),
      dropCode: db.prepare("DELETE FROM ui_codes WHERE subject = ?"),
      attemptsOf: db.prepare("SELECT failures, locked_until FROM ui_code_attempts WHERE customer_id = ?"),
      putAttempts: db.prepare("INSERT INTO ui_code_attempts (customer_id, failures, locked_until) VALUES (?, ?, ?) ON CONFLICT(customer_id) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until"),
      clearAttempts: db.prepare("DELETE FROM ui_code_attempts WHERE customer_id = ?"),
    };
  };
  const statements = () => (prepared ??= prepare());
  const hash = (code: string) => createHash("sha256").update(code).digest("hex");
  const attempts = (customerId: string) => (statements().attemptsOf.get(customerId) as { failures: number; locked_until: number } | undefined) ?? { failures: 0, locked_until: 0 };

  // Methods call each other through `api`, so they still work when destructured.
  const api = {
    /** The customer this subject is linked to, if any. */
    customerFor(subject: string): string | undefined {
      return (statements().linkOf.get(subject) as { customer_id: string } | undefined)?.customer_id;
    },
    /** Link directly, when you already know who it is (e.g. Meta shared a phone number that matches). */
    link(subject: string, customerId: string) {
      statements().link.run(subject, customerId, new Date().toISOString());
    },
    unlink(subject: string) {
      statements().unlink.run(subject);
    },
    /**
     * The user changed phone number and got a new BSUID: link the new one too. The old one stays linked unless you
     * pass `keepOld: false`, so links already sent to it keep working until they expire. False if it wasn't linked.
     */
    moveLink(previousSubject: string, subject: string, opts: { keepOld?: boolean } = {}): boolean {
      const customerId = api.customerFor(previousSubject);
      if (!customerId) return false;
      api.link(subject, customerId);
      if (opts.keepOld === false) statements().unlink.run(previousSubject);
      return true;
    },
    /**
     * A new code for this subject to prove they're `customerId`, replacing any earlier one. Send it through a channel
     * the customer already controls (email, SMS), never back to the chat. While the customer is locked out it returns
     * undefined; tell the user to try later without saying why, so nobody learns which accounts exist.
     */
    startVerification(subject: string, customerId: string): string | undefined {
      if (attempts(customerId).locked_until > Date.now()) return undefined;
      const code = String(randomInt(0, 10 ** digits)).padStart(digits, "0");
      statements().putCode.run(subject, customerId, hash(code), Date.now() + codeTtlMs);
      return code;
    },
    /** Drop this subject's waiting code (the user typed the wrong email and starts over). */
    cancelVerification(subject: string) {
      statements().dropCode.run(subject);
    },
    /** A code is waiting for this subject (it survives a reload while the user reads their email). */
    pending(subject: string): { customerId: string; expiresAt: string } | undefined {
      const row = statements().codeOf.get(subject) as { customer_id: string; expires_at: number } | undefined;
      return row && row.expires_at > Date.now() ? { customerId: row.customer_id, expiresAt: new Date(row.expires_at).toISOString() } : undefined;
    },
    /** Check a typed code. On success the subject is linked and the code is used up. */
    verify(subject: string, code: string): VerifyResult {
      const row = statements().codeOf.get(subject) as { customer_id: string; code_hash: string; expires_at: number } | undefined;
      if (!row) return { ok: false, reason: "no_code" };
      const customerId = row.customer_id;
      const tries = attempts(customerId);
      if (tries.locked_until > Date.now()) return { ok: false, reason: "locked" };
      if (row.expires_at <= Date.now()) {
        statements().dropCode.run(subject);
        return { ok: false, reason: "expired" };
      }
      const given = Buffer.from(hash(code.trim()), "hex");
      const expected = Buffer.from(row.code_hash, "hex");
      if (!timingSafeEqual(given, expected)) {
        const failures = tries.failures + 1;
        const locked = failures >= maxAttempts;
        statements().putAttempts.run(customerId, locked ? 0 : failures, locked ? Date.now() + lockMs : 0);
        if (locked) statements().dropCode.run(subject);
        return locked ? { ok: false, reason: "locked" } : { ok: false, reason: "wrong_code", attemptsLeft: maxAttempts - failures };
      }
      statements().dropCode.run(subject);
      statements().clearAttempts.run(customerId);
      api.link(subject, customerId);
      return { ok: true, customerId };
    },
  };
  return api;
}

export type SqliteIdentity = ReturnType<typeof sqliteIdentity>;
