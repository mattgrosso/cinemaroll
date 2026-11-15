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
/* Fixed TOP-RIGHT, just under the status bar (Matt, 2026-11-15, after it
   rode up the screen once more: "I want us to find another place to put the
   bug button"). It lived in the bottom-left corner from 2026-10-29, and
   before that bottom-right and a right-edge tab. Bottom-pinned things are
   what iOS keeps moving: its "phantom keyboard" shrinks the visible view
   and hangs fixed things from that view's bottom, and screenPin can't always
   tell (that day it judged the button "already at the bottom" 293 times while
   it floated mid-screen). Top-pinned things don't ride up; Thunder and Space
   Base keep theirs top-right. Clear of the header's scroll-to-top strip
   (which leaves 75px free at each end), of the top-LEFT back links, and it
   sits UNDER every pop-up (z-index below PersonModal's 1000) so no dialog's
   close button can be covered. Its own report box stays on top (1200).
   Sized as an always-visible tap target, no hover state. */
.bug-report-trigger {
  position: fixed;
  right: 0.75rem;
  top: calc(0.5rem + var(--safe-top, 0px));
  z-index: 990;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
  border: 2px solid #444;
  background: #1a1a1a;
  color: #eee;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
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
