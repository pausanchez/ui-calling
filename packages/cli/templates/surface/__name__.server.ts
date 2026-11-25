import { SurfaceError, implement } from "@ui-calling/core";
import { __const__ } from "./__name__.surface";

/**
 * Server-side half of "__surface__": where its data comes from and what its events do.
 * Register it: createUiCalling({ surfaces: [__const__Impl, ...] }).
 */
export const __const__Impl = implement(__const__, {
  // Runs when the link is opened. Only return what `ctx.subject` (the user the link was sent to) may see.
  resolve: async ({ id }, ctx) => {
    // TODO: load from your data source. Throw SurfaceError for expected failures: the agent is told.
    if (!id) throw new SurfaceError("not_found", "No record id was given");
    return { id, title: `TODO: load ${id} for ${ctx.subject}`, confirmed: false };
  },
  // Everything the screen shows, in one line: this is the agent's view of the screen.
  summarize: (d) => `${d.title} (${d.id}), ${d.confirmed ? "confirmed" : "not confirmed yet"}.`,
  on: {
    // Side effects for events. Return fresh data so the screen re-renders and the agent sees the outcome.
    confirmed: async (_payload, ctx) => {
      // TODO: save the confirmation.
      return { id: ctx.input.id, title: "TODO", confirmed: true };
    },
  },
});
