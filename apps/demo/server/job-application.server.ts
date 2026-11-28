import { SurfaceError, implement, type SurfaceContext, type SurfaceData } from "@ui-calling/core";
import { DAYS, jobApplication, jobApplicationSteps } from "../src/components/ui-calling/job-application.surface";
import { getApplication, listJobs, saveStep, submitApplication, type StoredApplication } from "./jobs";

type Application = SurfaceData<typeof jobApplication>;

/** The stored application plus the photos this link can show: the draft's (maybe from an earlier link) and new uploads. */
async function withUploads(a: StoredApplication, ctx: SurfaceContext): Promise<Application> {
  const saved = await ctx.files(a.draft.document.map((d) => d.id));
  const fresh = (await ctx.files()).filter((f) => !saved.some((s) => s.id === f.id));
  return { ...a, uploaded: [...saved, ...fresh].map((f) => ({ id: f.id, name: f.name })) };
}

function opening(jobId: string) {
  if (!listJobs().some((j) => j.id === jobId)) throw new SurfaceError("unknown_job", `No open job ${jobId}`, { refused: true });
}

/** Server-side half of "job_application": a draft saved step by step, then sent to the hiring team. */
export const jobApplicationImpl = implement(jobApplication, {
  // Scoped to the WhatsApp user the link was sent to: another candidate's link never shows this draft.
  resolve: async ({ job_id }, ctx) => {
    opening(job_id);
    return withUploads(getApplication(job_id, ctx.subject, ctx.locale), ctx);
  },
  // The agent's view: where the candidate is and what they gave, never the photos themselves.
  summarize: (a) => {
    const d = a.draft;
    const head = `Application for ${a.job.title} (${a.job.id}) at ${a.job.location}.`;
    const given =
      `Name: ${d.name ? JSON.stringify(d.name) : "not given"}. Town: ${d.town ? JSON.stringify(d.town) : "not given"}. ` +
      `Available: ${d.days.length ? `${d.days.join(", ")}, ${d.times.join(" and ")}` : "not given"}. ID photos: ${d.document.length}.`;
    if (a.submitted) return `${head} Sent as ${a.submitted.reference}; the hiring team replies by ${a.submitted.interviewBy}. ${given}`;
    return `${head} Draft, reached step ${jobApplicationSteps.indexOf(d.step) + 1} of 4 (${d.step}). ${given}`;
  },
  on: {
    about_saved: async ({ name, town }, ctx) =>
      withUploads(saveStep(ctx.input.job_id, ctx.subject, ctx.locale, { name: name.trim(), town: town.trim() }, "availability"), ctx),
    availability_saved: async ({ days, times }, ctx) => {
      const ordered = DAYS.filter((day) => days.includes(day));
      return withUploads(saveStep(ctx.input.job_id, ctx.subject, ctx.locale, { days: ordered, times }, "document"), ctx);
    },
    document_added: async ({ files }, ctx) => {
      // Only photos this candidate uploaded (through this link or an earlier one to this screen).
      const found = await ctx.files(files);
      if (found.length !== files.length) throw new SurfaceError("unknown_photo", "A photo isn't from this screen", { refused: true });
      return withUploads(saveStep(ctx.input.job_id, ctx.subject, ctx.locale, { document: found.map((f) => ({ id: f.id, name: f.name })) }, "review"), ctx);
    },
    application_sent: async (_p, ctx) => {
      const a = getApplication(ctx.input.job_id, ctx.subject, ctx.locale);
      if (a.submitted) return ctx.unchanged(await withUploads(a, ctx)); // a double tap: no second wake
      const d = a.draft;
      if (!d.name || !d.days.length || !d.document.length) throw new SurfaceError("incomplete", "A step is missing", { refused: true });
      return withUploads(submitApplication(ctx.input.job_id, ctx.subject, ctx.locale), ctx);
    },
  },
});
