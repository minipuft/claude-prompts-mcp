// @lifecycle canonical - Runs reloads one at a time, folding events that arrive mid-reload into one follow-up.
/**
 * Serializing prompt hot reloads without losing an event.
 *
 * A prompt reload re-reads every root and republishes the whole catalog, so two must never run at
 * once. `Application` used to enforce that by DROPPING any event that arrived while a reload ran:
 * a late-folder reconcile or a prompt edit landing inside that window was logged and discarded,
 * and the change it announced stayed unserved until some unrelated later change reloaded again.
 *
 * The rule here (OQ-9): at most one reload runs at a time, and every event that arrives while it
 * runs collapses into EXACTLY ONE reload afterwards, carrying every reason. One follow-up is
 * enough because a reload is not incremental — it reads the disk as it is when it starts, so a
 * single run that starts after the last queued event reflects all of them.
 *
 * Each caller's promise settles with the reload that reflects its event: the running one for the
 * event that started it, the follow-up for every event folded into it. A failed reload rejects
 * only its own callers, and the follow-up queued behind it still runs.
 */

import type { HotReloadEvent } from '#modules/hot-reload/hot-reload-observer.js';

/** Fold `next` into `queued`: every reason and affected file, and the widest reload either asked for. */
function mergeReloadEvents(queued: HotReloadEvent, next: HotReloadEvent): HotReloadEvent {
  // Fields that describe one file (category, framework or gate id, change type) do not survive a
  // merge — the follow-up is a full re-read, which is what the prompt reload always does anyway.
  return {
    type: queued.type === next.type ? next.type : 'reload_required',
    reason: `${queued.reason}; ${next.reason}`,
    affectedFiles: [...new Set([...queued.affectedFiles, ...next.affectedFiles])],
    timestamp: next.timestamp,
    requiresFullReload: queued.requiresFullReload || next.requiresFullReload,
  };
}

interface QueuedReload {
  /** Rewritten as events fold in; read once, when the queued reload starts. */
  pending: { event: HotReloadEvent };
  run: Promise<void>;
}

export class CoalescingReloadRunner {
  private active: Promise<void> | undefined;
  private queued: QueuedReload | undefined;

  constructor(private readonly reload: (event: HotReloadEvent) => Promise<void>) {}

  /** Reload for `event` now, or fold it into the one reload queued behind the running one. */
  submit(event: HotReloadEvent): Promise<void> {
    // Checked before `active`: between one reload settling and the queued one starting, `active`
    // is already cleared, and an event arriving then still belongs to the queued reload.
    if (this.queued !== undefined) {
      this.queued.pending.event = mergeReloadEvents(this.queued.pending.event, event);
      return this.queued.run;
    }
    if (this.active === undefined) {
      return this.start(event);
    }
    const pending = { event };
    // Runs whether the active reload succeeded or failed: its failure is its own callers' to see.
    const startQueued = (): Promise<void> => {
      this.queued = undefined;
      return this.start(pending.event);
    };
    this.queued = { pending, run: this.active.then(startQueued, startQueued) };
    return this.queued.run;
  }

  private start(event: HotReloadEvent): Promise<void> {
    const run = this.reload(event).finally(() => {
      if (this.active === run) this.active = undefined;
    });
    this.active = run;
    return run;
  }
}
