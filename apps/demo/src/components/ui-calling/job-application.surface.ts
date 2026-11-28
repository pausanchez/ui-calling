import { z } from "zod";
import { defineSurface, event } from "@ui-calling/core";

/** The steps, in order. */
export const jobApplicationSteps = ["about", "availability", "document", "review"] as const;
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const TIMES = ["morning", "afternoon", "night"] as const;

const file = z.object({ id: z.string(), name: z.string() });

/**
 * Contract for the "job_application" screen: a candidate applies to an opening in four steps, from WhatsApp.
 * Each step saves a draft with a quiet event, so the agent knows how far they got and reopening the link resumes
 * there. Only sending the application wakes the agent; a candidate who stops is reported by `abandoned`.
 */
export const jobApplication = defineSurface({
  name: "job_application",
  description:
    "A job application for one opening, in four steps: the candidate's name and town, which days and times they can work, a photo of their ID or work permit, and a final check before sending. Their progress is saved, so the same or a new link resumes where they stopped. Use it when someone wants to apply for a job, or asks how to apply. Doesn't need a linked account: candidates aren't customers.",
  input: z.object({ job_id: z.string().describe("The opening to apply for, e.g. J-310") }),
  cta: { en: "Apply", es: "Inscribirme" },
  files: { document: { accept: ["image/*"], maxBytes: 10_000_000, maxFiles: 2 } },
  data: z.object({
    job: z.object({ id: z.string(), title: z.string(), location: z.string(), pay: z.string(), schedule: z.string() }),
    draft: z.object({
      /** The furthest step the candidate saved: reopening the link resumes here. */
      step: z.enum(jobApplicationSteps),
      name: z.string(),
      town: z.string(),
      days: z.array(z.enum(DAYS)),
      times: z.array(z.enum(TIMES)),
      document: z.array(file),
    }),
    /** Photos the screen can show: the draft's, and any uploaded through this link since. */
    uploaded: z.array(file),
    /** Set once sent: the reference the agent tells the candidate. */
    submitted: z.object({ reference: z.string(), interviewBy: z.string() }).nullable(),
  }),
  events: {
    // Quiet steps. "Step N of 4" tells the agent where the candidate is if they stop.
    about_saved: event(z.object({ name: z.string().min(2).max(80), town: z.string().min(2).max(60) }), {
      describe: (p) => `Step 1 of 4: gave their name and town (${JSON.stringify(p.town)})`,
    }),
    availability_saved: event(z.object({ days: z.array(z.enum(DAYS)).min(1), times: z.array(z.enum(TIMES)).min(1) }), {
      describe: (p) => `Step 2 of 4: available ${p.days.join(", ")}, ${p.times.join(" and ")}`,
    }),
    document_added: event(z.object({ files: z.array(z.string()).min(1).max(2) }), {
      describe: (p) => `Step 3 of 4: added ${p.files.length} photo${p.files.length === 1 ? "" : "s"} of their ID or work permit`,
      reasons: ["unknown_photo"],
    }),
    // The finish line, and the only event that wakes the agent.
    application_sent: event(z.object({}), { describe: () => "Step 4 of 4: sent the application", wake: true, reasons: ["incomplete"] }),
  },
});
