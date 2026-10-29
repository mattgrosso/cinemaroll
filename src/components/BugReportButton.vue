<template>
  <button
    v-if="!isOpen"
    type="button"
    class="bug-report-trigger"
    title="Report a bug"
    aria-label="Report a bug"
    @click="open"
  >
    <i class="bi bi-bug-fill"></i>
  </button>

  <div v-if="isOpen" class="bug-report-backdrop" @click.self="close">
    <div class="bug-report-panel" role="dialog" aria-label="Report a bug">
      <template v-if="!sent">
        <h2 class="bug-report-panel__title">Report a bug</h2>
        <textarea
          ref="textarea"
          v-model="transcript"
          class="bug-report-panel__textarea"
          placeholder="What happened?"
          rows="5"
          :disabled="sending"
        ></textarea>
        <p v-if="error" class="bug-report-panel__error">{{ error }}</p>
        <div class="bug-report-panel__actions">
          <button type="button" class="btn btn-sm btn-outline-light" :disabled="sending" @click="close">Cancel</button>
          <button
            type="button"
            class="btn btn-sm btn-warning"
            :disabled="sending || !transcript.trim()"
            @click="send"
          >
            {{ sending ? 'Sending…' : 'Send report' }}
          </button>
        </div>
      </template>
      <p v-else-if="queuedOffline" class="bug-report-panel__sent"><i class="bi bi-check-circle-fill"></i> Saved — will send when you're back online.</p>
      <p v-else class="bug-report-panel__sent"><i class="bi bi-check-circle-fill"></i> Sent — thanks!</p>
    </div>
  </div>
</template>

<script>
import { submitBugReport } from '../utils/bugReports';

export default {
  name: 'BugReportButton',
  data () {
    return {
      isOpen: false,
      transcript: '',
      sending: false,
      error: null,
      sent: false,
      queuedOffline: false,
    };
  },
  methods: {
    open () {
      this.isOpen = true;
      this.sent = false;
      this.error = null;
      this.$nextTick(() => this.$refs.textarea?.focus());
    },
    close () {
      if (this.sending) return;
      this.isOpen = false;
      this.transcript = '';
      this.error = null;
    },
    async send () {
      if (!this.transcript.trim() || this.sending) return;
      this.sending = true;
      this.error = null;
      try {
        const result = await submitBugReport(this.$store, this.transcript, this.$route);
        this.sent = true;
        this.queuedOffline = Boolean(result && result.queued);
        this.transcript = '';
        setTimeout(() => { this.isOpen = false; this.sent = false; this.queuedOffline = false; }, 2200);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.sending = false;
      }
    },
  },
};
</script>

<style scoped>
/* Fixed bottom-RIGHT. It was moved left on 2026-08-01 by request, then back
   on 2026-10-27 ("I think I want it on the bottom right"). Since 2026-10-29
   it's a slim tab pressed flat against the right edge, 1rem wide: the
   width of the 1rem right margin nearly every screen keeps, so it sits in
   that margin instead of over the buttons that happen to scroll past the
   corner (report: "some of the things that we need to avoid aren't
   actually pinned. They just happen to show up at that spot"). Measured
   in WebKit at 402px: a 22px tab still clipped the edges of Home posters,
   game tiles and award buttons; 16px clears them. 3rem tall to make up the
   tap area. No hover state,
   per the project's mobile-first UI rule.
   A FIXED distance from the bottom, not 1rem + env(safe-area-inset-bottom):
   iOS Safari changes that inset while its toolbar shrinks and grows during a
   scroll, so the button jumped (report 2026-10-28, "coming unhinged on
   scroll"). 3.125rem is where the old formula put it on a home-indicator
   iPhone (16px + 34px), so it still clears the indicator and never moves.
   A screen with its own bottom-pinned strip raises it with --bug-tab-lift
   (src/utils/bugTabLift.js; the rating page's Cover Flow strip). */
.bug-report-trigger {
  position: fixed;
  right: 0;
  bottom: max(3.125rem, var(--bug-tab-lift, 0px));
  z-index: 1200;
  width: 1rem;
  height: 3rem;
  padding: 0;
  border-radius: 0.6rem 0 0 0.6rem;
  border: 2px solid #444;
  border-right: none;
  background: #1a1a1a;
  color: #eee;
  font-size: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: -2px 2px 8px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  opacity: 0.75;
}

.bug-report-trigger:active {
  opacity: 1;
  border-color: #ffc107;
}

.bug-report-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.bug-report-panel {
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 0.6rem;
  padding: 1.25rem 1.5rem;
  max-width: min(420px, 90vw);
  width: 100%;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.bug-report-panel__title {
  color: #eee;
  font-size: 1.05rem;
  margin: 0;
}

.bug-report-panel__textarea {
  width: 100%;
  resize: vertical;
  background: #0d0d0d;
  color: #eee;
  border: 1px solid #444;
  border-radius: 0.4rem;
  padding: 0.5rem;
  font: inherit;
}

.bug-report-panel__error {
  color: #ff6a6a;
  font-size: 0.9rem;
  margin: 0;
}

.bug-report-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.bug-report-panel__sent {
  color: #eee;
  text-align: center;
  margin: 0.5rem 0;
}
</style>
