import type { SurfaceData } from "@ui-calling/core";
import { jobApplicationSteps, type jobApplication } from "../src/components/ui-calling/job-application.surface";

type Application = SurfaceData<typeof jobApplication>;
type Draft = Application["draft"];
type Step = Draft["step"];
type Lang = "en" | "es";
/** An opening as the job board keeps it: in both languages, pay as a number. */
type Job = { id: string; title: Record<Lang, string>; location: string; payPerHour: number; schedule: Record<Lang, string> };
export type StoredApplication = Omit<Application, "uploaded">;

// Stand-in for the product's job board and applicant tracking system. Applications are keyed by the WhatsApp
// subject: candidates aren't customers, so there's no account to hang them on until someone hires them.
const jobs = new Map<string, Job>();
const applications = new Map<string, { draft: Draft; submitted: Application["submitted"] }>();

/** For the demo's persistence (app.ts). */
export const jobsState = {
  save: () => ({ jobs: [...jobs], applications: [...applications] }),
  load: (s: { jobs: [string, Job][]; applications: [string, { draft: Draft; submitted: Application["submitted"] }][] }) => {
    jobs.clear();
    applications.clear();
    s.jobs.forEach(([k, v]) => jobs.set(k, v));
    s.applications.forEach(([k, v]) => applications.set(k, v));
  },
};

export function seedJobs() {
  jobs.clear();
  applications.clear();
  for (const job of [
    {
      id: "J-310",
      title: { en: "Warehouse picker", es: "Preparador/a de pedidos" },
      location: "Acme warehouse Zona Franca, Barcelona",
      payPerHour: 11.2,
      schedule: { en: "Morning, afternoon or night shifts", es: "Turnos de mañana, tarde o noche" },
    },
    {
      id: "J-311",
      title: { en: "Store assistant", es: "Dependiente/a" },
      location: "Acme Store Gràcia, Barcelona",
      payPerHour: 10.8,
      schedule: { en: "Weekends, 20 hours a week", es: "Fines de semana, 20 horas a la semana" },
    },
  ] satisfies Job[]) {
    jobs.set(job.id, job);
  }
}

/** An opening in one language, as the screen and the agent show it. */
function inLanguage(job: Job, locale: string): Application["job"] {
  const lang: Lang = locale.startsWith("es") ? "es" : "en";
  const pay = job.payPerHour.toLocaleString(lang, { style: "currency", currency: "EUR" });
  return { id: job.id, title: job.title[lang], location: job.location, pay: lang === "es" ? `${pay}/hora` : `${pay}/hour`, schedule: job.schedule[lang] };
}

/** Open jobs, for the agent's system prompt (in English, like the rest of what the agent reads). */
export function listJobs() {
  return [...jobs.values()].map((j) => inLanguage(j, "en"));
}

const key = (jobId: string, subject: string) => `${subject}:${jobId}`;
const blank = (): Draft => ({ step: "about", name: "", town: "", days: [], times: [], document: [] });

export function getApplication(jobId: string, subject: string, locale = "en"): StoredApplication {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`No opening ${jobId}`);
  const a = applications.get(key(jobId, subject)) ?? { draft: blank(), submitted: null };
  return { job: inLanguage(job, locale), draft: a.draft, submitted: a.submitted };
}

/** Save a step: merge it into the draft and move the furthest step reached forward, never back. */
export function saveStep(jobId: string, subject: string, locale: string, patch: Partial<Draft>, reached: Step) {
  const a = getApplication(jobId, subject);
  const step = jobApplicationSteps.indexOf(reached) > jobApplicationSteps.indexOf(a.draft.step) ? reached : a.draft.step;
  applications.set(key(jobId, subject), { draft: { ...a.draft, ...patch, step }, submitted: a.submitted });
  return getApplication(jobId, subject, locale);
}

export function submitApplication(jobId: string, subject: string, locale: string) {
  const a = getApplication(jobId, subject);
  const interviewBy = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
  const submitted = { reference: `APP-${Math.floor(10000 + Math.random() * 90000)}`, interviewBy };
  applications.set(key(jobId, subject), { draft: a.draft, submitted });
  return getApplication(jobId, subject, locale);
}

seedJobs();
