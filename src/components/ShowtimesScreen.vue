<template>
  <div class="showtimes">
    <BackLink/>
    <div class="st-head">
      <h1 class="st-title">Showtimes</h1>
      <button v-if="!loading && (board || following)" type="button" class="st-edit" @click="$router.push('/showtimes/theaters')">
        <i class="bi bi-geo-alt"></i> Your theaters
      </button>
    </div>
    <p class="st-subtitle">What's on the boards at the theaters you follow. Swipe right to dismiss, left to be reminded before it plays. Hold a poster when you've got tickets.</p>
    <transition name="st-toast">
      <div v-if="toast" class="st-toast" role="status">{{ toast }}</div>
    </transition>

    <SkeletonBlock v-if="loading" :rows="6"/>

    <template v-else-if="board">
      <!-- One line, never wrapping (Matt, 2026-09-29: "streamline that down
           to one line"): short icon+word pills sharing the width as one
           segmented bar; the long wording lives in aria-label. -->
      <div class="st-controls">
        <button type="button" class="st-toggle" :class="{ on: onlyUnique }" @click="onlyUnique = !onlyUnique" :aria-pressed="onlyUnique" aria-label="Only films no better theater has">
          <i class="bi" :class="onlyUnique ? 'bi-funnel-fill' : 'bi-funnel'"></i>
          <span>Unique</span>
        </button>
        <button v-if="dismissedCount" type="button" class="st-toggle" :class="{ on: showDismissed }" @click="showDismissed = !showDismissed" :aria-pressed="showDismissed" :aria-label="`Show ${dismissedCount} dismissed`">
          <i class="bi" :class="showDismissed ? 'bi-eye-fill' : 'bi-eye-slash'"></i>
          <span>{{ dismissedCount }}</span>
        </button>
        <button v-if="ticketsCount" type="button" class="st-toggle" :class="{ on: showTickets }" @click="showTickets = !showTickets" :aria-pressed="showTickets" :aria-label="`Show ${ticketsCount} film${ticketsCount === 1 ? '' : 's'} you have tickets for`">
          <i class="bi" :class="showTickets ? 'bi-ticket-perforated-fill' : 'bi-ticket-perforated'"></i>
          <span>{{ ticketsCount }}</span>
        </button>
        <button v-if="waitingCount" type="button" class="st-toggle" :class="{ on: showWaiting }" @click="showWaiting = !showWaiting" :aria-pressed="showWaiting" :aria-label="`Show ${waitingCount} reminder${waitingCount === 1 ? '' : 's'}`">
          <i class="bi" :class="showWaiting ? 'bi-bell-fill' : 'bi-bell'"></i>
          <span>{{ waitingCount }}</span>
        </button>
      </div>
      <p class="st-updated">Checked {{ ago(board.updatedAt) }}</p>

      <section v-for="theater in theaters" :key="theater.key" class="st-theater">
        <h2 class="st-theater-name">
          <a v-if="hrefFor(theater)" :href="hrefFor(theater)" :target="targetFor(hrefFor(theater))" rel="noopener">{{ theater.name }}</a>
          <span v-else>{{ theater.name }}</span>
          <span class="st-count">{{ theater.shown.length }}</span>
        </h2>
        <p v-if="!theater.ok" class="st-empty">Couldn't read this board last time.</p>
        <p v-else-if="!theater.shown.length" class="st-empty">
          {{ theater.listings.length ? 'Nothing here you haven\'t handled or a better theater lacks.' : 'Nothing listed.' }}
        </p>
        <!-- Posters, not names (Matt: "I like posters more than text"), one
             to a row ("make these posters be one across and swiping right
             dismisses them", 2026-09-28). A card is the film's poster with a
             thin caption; the X and a swipe to the right both dismiss it. -->
        <div v-else class="st-grid">
          <div
            v-for="item in theater.shown"
            :key="item.slug"
            class="st-card"
            :class="{ covered: item.coveredBy, dismissed: item.dismissed, tickets: item.tickets, waiting: item.waiting, pressed: pressed === cardId(theater, item), focused: focus === cardId(theater, item), leaving: leaving === cardId(theater, item), 'leaving-left': leavingLeft === cardId(theater, item) }"
            :data-card="cardId(theater, item)"
            :style="cardStyle(theater, item)"
            @touchstart.passive="touchStart($event, theater, item)"
            @touchmove.passive="touchMove($event, theater, item)"
            @touchend="touchEnd($event, theater, item)"
            @touchcancel="touchEnd($event, theater, item, true)"
            @contextmenu.prevent
          >
            <a class="st-card-link" :href="hrefFor(theater, item)" :target="targetFor(hrefFor(theater, item))" rel="noopener" @click="blockIfSwiping($event)">
              <img
                v-if="posterFor(item)"
                :src="posterFor(item)"
                :alt="item.title"
                class="st-poster"
                loading="lazy"
                @error="posterFailed(item)"
              >
              <div v-else class="st-poster st-poster-blank"><span>{{ item.title }}</span></div>
              <div class="st-tags">
                <span v-if="item.imax" class="st-tag">IMAX</span>
                <span v-if="isNew(item)" class="st-tag new">new</span>
                <span v-if="item.tickets" class="st-tag tickets"><i class="bi bi-ticket-perforated-fill"></i> tickets</span>
                <span v-if="item.waiting" class="st-tag remind"><i class="bi bi-bell-fill"></i> {{ remindLabel(item.reminder) }}</span>
                <span v-else-if="item.reminded" class="st-tag reminded">reminded</span>
              </div>
              <div class="st-swipe-hint left" :style="hintStyle(theater, item, 'left')"><i class="bi bi-bell-fill"></i> Remind me</div>
              <div class="st-swipe-hint right" :style="hintStyle(theater, item, 'right')"><i class="bi bi-x-lg"></i> Dismiss</div>
              <div class="st-caption">
                <span class="st-caption-title">{{ captionTitle(item) }}</span>
                <span class="st-caption-when">{{ when(item) }}</span>
                <span v-if="item.coveredBy" class="st-caption-also">Also at {{ nameOf(item.coveredBy) }}</span>
              </div>
            </a>
            <button
              v-if="item.tickets"
              type="button"
              class="st-dismiss"
              :aria-label="`Undo got tickets for ${item.title}`"
              @click.stop="undoTickets(item)"
            >
              <i class="bi bi-arrow-counterclockwise"></i>
            </button>
            <button
              v-else-if="item.waiting"
              type="button"
              class="st-dismiss"
              :aria-label="`Cancel the reminder for ${item.title}`"
              @click.stop="cancelReminder(theater, item)"
            >
              <i class="bi bi-bell-slash"></i>
            </button>
            <button
              v-else
              type="button"
              class="st-dismiss"
              :aria-label="item.dismissed ? `Bring back ${item.title}` : `Dismiss ${item.title}`"
              @click.stop="toggleDismiss(theater, item)"
            >
              <i class="bi" :class="item.dismissed ? 'bi-arrow-counterclockwise' : 'bi-x-lg'"></i>
            </button>
            <!-- Hold, let go, confirm (2026-10-27): the sheet sits on the
                 card, outside the link, so its taps never open the theater. -->
            <div
              v-if="ticketSheet === cardId(theater, item)"
              class="st-sheet"
              role="dialog"
              :aria-label="`Got tickets for ${item.title}?`"
              @touchstart.stop
              @click.stop
            >
              <p class="st-sheet-title">Got tickets for {{ item.title }}?</p>
              <div class="st-sheet-buttons">
                <button type="button" class="st-sheet-cancel" @click="ticketSheet = null">Cancel</button>
                <button type="button" class="st-sheet-yes" @click="gotTickets(theater, item)">
                  <i class="bi bi-ticket-perforated-fill"></i> Got tickets
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <p v-else-if="following" class="st-empty">No board yet. It's built every 15 minutes; check back shortly.</p>
    <!-- Anyone's theaters (2026-09-30): the way in for everyone but Matt. -->
    <div v-else class="st-start">
      <i class="bi bi-film st-start-icon"></i>
      <h2 class="st-start-title">Follow your local theaters</h2>
      <p class="st-start-text">
        Pick the theaters near you and rank them. You'll see what's on their boards here, and get a
        notification when a new film is listed at the best one showing it.
      </p>
      <button type="button" class="st-start-button" @click="$router.push('/showtimes/theaters')">Choose theaters</button>
    </div>
  </div>
</template>

<script>
import BackLink from './games/BackLink.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import { lookupFilm, titleWithYear } from '../utils/posterLookup.js';
import { reminderTimeFor } from '../utils/reminderTime.js';
import { theaterHref, opensInNewTab } from '../assets/javascript/theaterLinks.js';
import { SHOWTIMES_SEEN_KEY, dismissedFilms, dismissedAtRank, titleKey } from '../assets/javascript/showtimesUnread.js';
import { isTicketsMark, filmCopies, ticketFilms } from '../assets/javascript/showtimesTickets.js';

// Matt, 2026-09-28: "it would also be great if I could see this somewhere on
// Cinemaroll, besides just the push notification … a page … that would show
// me the list of showtimes coming up." Then: "I'd rather see movie posters
// than names … a way for me to dismiss things off of this screen … swipe it
// off or maybe hit an X." Then: "swipe right dismiss so it's gone. Swipe left
// can be remind me again one week before the showtime." The push sweep
// publishes the board
// (aws-lambda/push-notify.js, boardForApp); this screen reads it, fills in
// posters the feeds didn't carry (TMDB, cached on the device), and records
// dismissals under theaters/dismissed. Theaters are in pecking order and, by
// default, a film a better theater also has is hidden - the rule the pushes
// follow.

export { SHOWTIMES_SEEN_KEY };
const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000;
// A right swipe dismisses once it has travelled this far or a third of the
// card, whichever is less - a flick on a phone, not a drag across it.
const SWIPE_DISMISS_PX = 110;
// "A long press on the poster, and then it like confirms and I tap a got
// tickets button" (2026-10-27). Held this long without moving past the
// swipe's 8px, the card lifts; letting go opens the sheet.
export const LONG_PRESS_MS = 500;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-10-02T15:20:00" (the cinema's own clock) or "2026-10-02" -> a
// label; string arithmetic on purpose so no timezone gets a say.
export function showtimeLabel (stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(stamp || '');
  if (!m) return '';
  const [y, mo, d] = m.slice(1, 4).map(Number);
  const day = `${WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${MONTHS[mo - 1]} ${d}`;
  if (m[4] === undefined) return day;
  const h = Number(m[4]);
  return `${day}, ${h % 12 || 12}:${m[5]} ${h < 12 ? 'AM' : 'PM'}`;
}

export default {
  name: 'ShowtimesScreen',
  components: { BackLink, SkeletonBlock },
  data () {
    let onlyUnique = true;
    try { onlyUnique = localStorage.getItem('showtimesOnlyUnique') !== 'no'; } catch { /* private mode */ }
    return {
      loading: true,
      onlyUnique,
      showDismissed: false,
      showWaiting: false,
      showTickets: false,
      toast: '',
      toastTimer: null,
      now: Date.now(),
      // Posters and years the feeds didn't carry, looked up by title:
      // { [key]: { poster, year } }.
      lookedUp: {},
      failed: {},
      // Swipe state for the one card under a finger.
      swipe: null,
      leaving: null,
      leavingLeft: null,
      // The long press: the card being held past LONG_PRESS_MS, and the card
      // whose "Got tickets" sheet is open.
      pressed: null,
      ticketSheet: null,
      // A notification tap lands here with ?focus=<theater>/<slug>: that card
      // is shown whatever its state, scrolled to and lit for a moment.
      focus: null
    };
  },
  computed: {
    board () { return this.$store.state.theaterBoard; },
    following () { return Boolean(this.$store.state.theaterFollow?.theaters?.length); },
    // The "Open Alamo" Shortcut is on Matt's phone only (theaterLinks.js).
    alamoApp () { return this.$store.state.databaseTopKey === 'mattgrosso-gmail-com'; },
    dismissedMap () { return this.$store.state.theaterDismissed || {}; },
    // A film dismissed at one theater is dismissed there and at every worse
    // theater, but still shows at a better one (2026-10-06).
    dismissedTitles () {
      return dismissedFilms(Array.isArray(this.board?.theaters) ? this.board.theaters : [], this.dismissedMap);
    },
    dismissedCount () {
      return this.theaters.reduce((n, t) => n + t.listings.filter((l) => l.dismissed).length, 0);
    },
    ticketTitles () {
      return ticketFilms(Array.isArray(this.board?.theaters) ? this.board.theaters : [], this.dismissedMap);
    },
    // Films, not copies: tickets cover a film at every theater.
    ticketsCount () {
      const films = new Set();
      this.theaters.forEach((t) => t.listings.forEach((l) => { if (l.tickets) films.add(titleKey(l.title) || l.slug); }));
      return films.size;
    },
    remindersMap () { return this.$store.state.theaterReminders || {}; },
    waitingCount () {
      return Object.values(this.remindersMap).reduce((n, slugs) => n + Object.values(slugs || {}).filter((r) => r && !r.sentAt).length, 0);
    },
    theaters () {
      const list = Array.isArray(this.board?.theaters) ? this.board.theaters : [];
      return list.map((t, rank) => {
        const listings = (Array.isArray(t.listings) ? t.listings : [])
          .map((l) => {
            const reminder = this.remindersMap[t.key]?.[l.slug] || null;
            // Tickets are their own pile, never counted as dismissed.
            const tickets = isTicketsMark(this.dismissedMap[t.key]?.[l.slug]) || this.ticketTitles.has(titleKey(l.title));
            return {
              ...l,
              tickets,
              dismissed: !tickets && (Boolean(this.dismissedMap[t.key]?.[l.slug]) || dismissedAtRank(this.dismissedTitles, l.title, rank)),
              reminder,
              waiting: Boolean(reminder && !reminder.sentAt),
              reminded: Boolean(reminder && reminder.sentAt)
            };
          });
        listings.sort((a, b) => (a.firstShowTime || '9999').localeCompare(b.firstShowTime || '9999'));
        const shown = listings.filter((l) => (this.showDismissed || !l.dismissed) && (this.showTickets || !l.tickets) && (this.showWaiting || !l.waiting) && (!this.onlyUnique || !l.coveredBy));
        return { ...t, listings, shown };
      });
    }
  },
  watch: {
    onlyUnique (value) {
      try { localStorage.setItem('showtimesOnlyUnique', value ? 'yes' : 'no'); } catch { /* private mode */ }
    },
    theaters: {
      handler () { this.fillPosters(); },
      immediate: false
    }
  },
  async mounted () {
    try {
      await Promise.all([
        this.$store.dispatch('loadTheaterBoard'),
        this.$store.dispatch('loadTheaterFollow')
      ]);
    } catch (error) {
      console.warn('Showtimes: board unavailable', error);
    }
    this.loading = false;
    // The Insights card's "new" pill is relative to the last visit here.
    try { localStorage.setItem(SHOWTIMES_SEEN_KEY, String(Date.now())); } catch { /* private mode */ }
    this.fillPosters();
    this.focusFromQuery();
  },
  beforeUnmount () {
    clearTimeout(this.pressTimer);
  },
  methods: {
    cardId (theater, item) { return `${theater.key}/${item.slug}`; },
    // Alamo opens its app, everything else the theater's page (theaterLinks.js).
    hrefFor (theater, item) { return theaterHref(theater, item, { alamoApp: this.alamoApp }); },
    targetFor (href) { return opensInNewTab(href) ? '_blank' : null; },
    posterKey (item) { return `${item.title}|${item.year || ''}`; },
    posterFor (item) {
      if (item.poster && !this.failed[this.cardKeyFor(item)]) return item.poster;
      const hit = this.lookedUp[this.posterKey(item)];
      return (hit && hit.poster) || null;
    },
    yearFor (item) {
      if (Number.isInteger(item.year)) return item.year;
      const hit = this.lookedUp[this.posterKey(item)];
      return (hit && hit.year) || null;
    },
    captionTitle (item) {
      return titleWithYear(item.title, this.yearFor(item));
    },
    cardKeyFor (item) { return `${item.slug}:${item.poster || ''}`; },
    posterFailed (item) {
      // A feed's poster URL that 404s (Veezi's placeholder, an expired CDN
      // link) falls through to the TMDB lookup.
      this.failed = { ...this.failed, [this.cardKeyFor(item)]: true };
      this.fillPosters();
    },
    fillPosters () {
      this.theaters.forEach((theater) => theater.shown.forEach((item) => {
        if (this.posterFor(item) && this.yearFor(item)) return;
        const key = this.posterKey(item);
        if (key in this.lookedUp) return;
        this.lookedUp = { ...this.lookedUp, [key]: null };
        lookupFilm(item.title, item.year)
          .then((hit) => {
            if (hit && (hit.poster || hit.year)) this.lookedUp = { ...this.lookedUp, [key]: hit };
            return hit;
          })
          .catch(() => null);
      }));
    },
    when (item) {
      const label = showtimeLabel(item.firstShowTime);
      if (!label) return 'On the board';
      return `${label.includes(',') ? 'First showing' : 'From'} ${label}`;
    },
    isNew (item) {
      return Number(item.firstSeenAt) > this.now - NEW_FOR_MS;
    },
    nameOf (key) {
      const t = (this.board?.theaters || []).find((x) => x.key === key);
      return t ? t.name.replace(/^the /, '') : 'a better theater';
    },
    ago (at) {
      const mins = Math.round((this.now - Number(at)) / 60000);
      if (!Number.isFinite(mins) || mins < 1) return 'just now';
      if (mins < 60) return `${mins} min ago`;
      const hours = Math.round(mins / 60);
      return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
    },
    // "Clicking on the notification should … take me to Cinema Roll, to the
    // Showtimes page, where I can look and see when the movie is playing"
    // (2026-09-28). The push sends /showtimes?focus=<theater>/<slug>.
    focusFromQuery () {
      const focus = typeof this.$route?.query?.focus === 'string' ? this.$route.query.focus : '';
      if (!focus) return;
      // Strip it so a refresh doesn't re-scroll; then make sure the card is
      // on screen whatever filter would hide it.
      this.$router.replace({ path: this.$route.path }).catch(() => {});
      const [theaterKey, slug] = focus.split('/');
      const theater = this.theaters.find((t) => t.key === theaterKey);
      const item = theater && theater.listings.find((l) => l.slug === slug);
      if (!item) return;
      if (item.dismissed) this.showDismissed = true;
      if (item.tickets) this.showTickets = true;
      if (item.waiting) this.showWaiting = true;
      if (item.coveredBy) this.onlyUnique = false;
      this.focus = focus;
      this.$nextTick(() => {
        const el = this.$el.querySelector(`[data-card="${CSS.escape(focus)}"]`);
        if (el) el.scrollIntoView({ block: 'center' });
        setTimeout(() => { this.focus = null; }, 4000);
      });
    },
    say (message) {
      this.toast = message;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.toast = ''; }, 2600);
    },
    remindLabel (reminder) {
      const at = Number(reminder && reminder.remindAt);
      if (!at) return 'reminder set';
      const d = new Date(at);
      return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    },
    // Swipe left: a reminder a week before the showing, else the day before,
    // else three hours before; a film with no date yet, or one whose rungs
    // have all passed with no known end to its run, is snoozed a week.
    // One that starts today but runs on is held for its last showing.
    remind (theater, item) {
      const choice = reminderTimeFor(item.firstShowTime, Date.now(), { lastShowTime: item.lastShowTime });
      if (!choice) {
        this.say(`${item.title} plays too soon to remind you about`);
        return;
      }
      const reminder = {
        remindAt: choice.remindAt,
        setAt: Date.now(),
        title: item.title,
        theaterName: theater.name,
        url: item.url || theater.url || null,
        // A snooze past today's showings mustn't push a date already gone.
        firstShowTime: choice.snooze ? null : item.firstShowTime,
        ...(choice.lastChance ? { lastChance: true, lastShowTime: item.lastShowTime } : {})
      };
      this.leavingLeft = this.cardId(theater, item);
      setTimeout(() => {
        this.leavingLeft = null;
        this.$store.dispatch('remindListing', { theaterKey: theater.key, slug: item.slug, reminder }).catch(() => {});
        this.say(choice.lastChance
          ? `Last chance reminder, ${choice.label}: ${this.remindLabel(reminder)}`
          : `Reminder ${choice.label}: ${this.remindLabel(reminder)}`);
      }, 180);
    },
    cancelReminder (theater, item) {
      this.$store.dispatch('remindListing', { theaterKey: theater.key, slug: item.slug, reminder: null }).catch(() => {});
      this.say(`No reminder for ${item.title}`);
    },
    hintStyle (theater, item, side) {
      const s = this.swipe;
      if (!s || s.id !== this.cardId(theater, item) || !s.horizontal) return { opacity: 0 };
      const toward = side === 'right' ? s.dx : -s.dx;
      return { opacity: String(Math.min(1, Math.max(0, toward / 70))) };
    },
    toggleDismiss (theater, item) {
      const id = this.cardId(theater, item);
      if (item.dismissed) {
        // Bringing a film back lifts every dismissal hiding this copy: its
        // own, and the film's at this theater or any better one.
        const film = titleKey(item.title);
        const list = this.board?.theaters || [];
        const here = list.findIndex((t) => t.key === theater.key);
        list.forEach((t, rank) => (t.listings || []).forEach((l) => {
          if (!this.dismissedMap[t.key]?.[l.slug]) return;
          if (!(t.key === theater.key && l.slug === item.slug) && (!film || rank > here || titleKey(l.title) !== film)) return;
          this.$store.dispatch('dismissListing', { theaterKey: t.key, slug: l.slug, restore: true }).catch(() => {});
        }));
        return;
      }
      // Let the card slide away before it leaves the grid.
      this.leaving = id;
      setTimeout(() => {
        this.leaving = null;
        this.$store.dispatch('dismissListing', { theaterKey: theater.key, slug: item.slug }).catch(() => {});
      }, 180);
    },
    // Got tickets: every copy of the film on the board is marked (a
    // dismissal with a note, showtimesTickets.js), which also clears its
    // notifications, and any reminder waiting on it is cancelled.
    gotTickets (theater, item) {
      this.ticketSheet = null;
      const copies = filmCopies(this.board?.theaters || [], item.title);
      if (!copies.some((c) => c.theaterKey === theater.key && c.slug === item.slug)) copies.push({ theaterKey: theater.key, slug: item.slug });
      this.leaving = this.cardId(theater, item);
      setTimeout(() => {
        this.leaving = null;
        copies.forEach(({ theaterKey, slug }) => {
          this.$store.dispatch('dismissListing', { theaterKey, slug, tickets: true }).catch(() => {});
          if (this.remindersMap[theaterKey]?.[slug]) this.$store.dispatch('remindListing', { theaterKey, slug, reminder: null }).catch(() => {});
        });
        this.say(`Got tickets for ${item.title}`);
      }, 180);
    },
    // Undo lifts the film's tickets everywhere; it comes back as unhandled.
    undoTickets (item) {
      const film = titleKey(item.title);
      (this.board?.theaters || []).forEach((t) => (t.listings || []).forEach((l) => {
        if (!isTicketsMark(this.dismissedMap[t.key]?.[l.slug])) return;
        if (film ? titleKey(l.title) !== film : l.slug !== item.slug) return;
        this.$store.dispatch('dismissListing', { theaterKey: t.key, slug: l.slug, restore: true }).catch(() => {});
      }));
      this.say(`No tickets for ${item.title}`);
    },
    cancelPress () {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
      this.pressed = null;
    },
    // Swipe RIGHT to dismiss, LEFT to be reminded (the back gesture owns the
    // left 20px of the screen, and the cards start 30px in, so the two
    // never meet).
    // Horizontal intent is decided once (a mostly vertical move is a scroll
    // and the card stays put); a release past the threshold dismisses,
    // short of it snaps back.
    // A press that stays put for LONG_PRESS_MS lifts the card instead; any
    // move past 8px (a scroll or a swipe deciding itself) calls it off.
    touchStart (event, theater, item) {
      this.cancelPress();
      if (item.dismissed || item.tickets || event.touches.length !== 1) return;
      const t = event.touches[0];
      const id = this.cardId(theater, item);
      // A touch on a card whose sheet is open only closes it (the click
      // that follows is blocked); on any other card it's a fresh gesture.
      if (this.ticketSheet === id) return;
      this.ticketSheet = null;
      this.swipe = { id, x: t.clientX, y: t.clientY, dx: 0, horizontal: null, fired: false };
      this.pressTimer = setTimeout(() => {
        this.pressTimer = null;
        if (!this.swipe || this.swipe.id !== id || this.swipe.horizontal !== null) return;
        this.pressed = id;
        try { navigator.vibrate?.(15); } catch { /* not on iOS */ }
      }, LONG_PRESS_MS);
    },
    touchMove (event, theater, item) {
      const s = this.swipe;
      if (!s || s.id !== this.cardId(theater, item)) return;
      const t = event.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) this.cancelPress();
      if (s.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!s.horizontal) return;
      this.swipe = { ...s, dx };
    },
    touchEnd (event, theater, item, cancelled = false) {
      const s = this.swipe;
      if (!s || s.id !== this.cardId(theater, item)) return;
      this.swipe = null;
      const held = this.pressed === s.id;
      this.cancelPress();
      if (held && !cancelled) {
        // Letting go of a held card opens its sheet, and must not also
        // follow the link underneath.
        if (event && event.cancelable) event.preventDefault();
        this.justSwiped = Date.now();
        this.ticketSheet = s.id;
        return;
      }
      if (cancelled || !s.horizontal) return;
      const width = (event && event.currentTarget && event.currentTarget.offsetWidth) || 0;
      const threshold = Math.min(SWIPE_DISMISS_PX, width ? width / 3 : SWIPE_DISMISS_PX);
      if (s.dx >= threshold) {
        this.justSwiped = Date.now();
        this.toggleDismiss(theater, item);
      } else if (-s.dx >= threshold) {
        this.justSwiped = Date.now();
        if (item.waiting) this.say(`Already set: ${this.remindLabel(item.reminder)}`);
        else this.remind(theater, item);
      }
    },
    blockIfSwiping (event) {
      // The tap that ends a swipe must not also open the ticket page.
      if (Date.now() - (this.justSwiped || 0) < 400) event.preventDefault();
      else if (this.ticketSheet) {
        event.preventDefault();
        this.ticketSheet = null;
      }
    },
    cardStyle (theater, item) {
      const s = this.swipe;
      if (s && s.id === this.cardId(theater, item) && s.horizontal) {
        return { transform: `translateX(${s.dx}px)`, opacity: String(Math.max(0.35, 1 - Math.abs(s.dx) / 300)), transition: 'none' };
      }
      return null;
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/screen-top';
.showtimes {
  color: #eee;
  padding: $screen-top-gap 1rem 2rem;
}

.st-head {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.st-title { margin: 0; }

.st-edit {
  align-items: center;
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 999px;
  color: #ddd;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 0.78rem;
  gap: 0.35rem;
  min-height: 40px;
  padding: 0.35rem 0.8rem;

  i { color: #ffc107; }
  &:active { background: #222; }
}

.st-start {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-top: 0.5rem;
  padding: 1.4rem 1.1rem;
  text-align: center;
}

.st-start-icon { color: #ffc107; font-size: 2rem; }
.st-start-title { font-size: 1.1rem; font-weight: 700; margin: 0.4rem 0 0.4rem; }
.st-start-text { color: #ccc; font-size: 0.86rem; margin: 0 0 1rem; }

.st-start-button {
  background: #ffc107;
  border: 0;
  border-radius: 8px;
  color: #111;
  font-weight: 700;
  min-height: 44px;
  padding: 0.5rem 1.4rem;

  &:active { background: #e0a800; }
}
.st-subtitle { color: #ccc; font-size: 0.85rem; margin: 0.25rem 0 0.9rem; }

.st-controls {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.st-toggle {
  align-items: center;
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 999px;
  color: #ccc;
  display: inline-flex;
  flex: 1 1 0;
  font-size: 0.78rem;
  gap: 0.4rem;
  justify-content: center;
  min-height: 40px;
  min-width: 0;
  padding: 0.35rem 0.7rem;
  white-space: nowrap;

  i { color: #777; }
  &.on { color: #fff; border-color: #ffc107; }
  &.on i { color: #ffc107; }
  &:active { background: #222; }
}

.st-updated { color: #999; font-size: 0.72rem; margin: 0 0 0.9rem; }

.st-theater {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 0.9rem;
  padding: 0.8rem 0.9rem;
}

.st-theater-name {
  align-items: center;
  display: flex;
  font-size: 1.02rem;
  font-weight: 700;
  gap: 0.5rem;
  margin: 0 0 0.5rem;

  a { color: inherit; text-decoration: none; }
}

.st-count {
  background: #2b2b2b;
  border-radius: 999px;
  color: #bbb;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.05rem 0.45rem;
}

.st-empty { color: #999; font-size: 0.82rem; margin: 0.2rem 0 0; }

/* One poster to a row, the width of the section, so a swipe has room to
   be a swipe. Wider screens get two so a desktop isn't a wall of one. */
.st-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: 1fr;

  @media (min-width: 700px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 1100px) {
    grid-template-columns: repeat(3, 1fr);
  }
}

.st-card {
  background: #0f0f0f;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  transition: transform 0.18s ease, opacity 0.18s ease;
  touch-action: pan-y;

  &.covered { opacity: 0.55; }
  &.dismissed { opacity: 0.4; }
  &.tickets { opacity: 0.6; }
  &.pressed { transform: scale(1.03); }
  &.waiting { opacity: 0.75; }
  &.focused { box-shadow: 0 0 0 3px #ffc107; }
  &.leaving { transform: translateX(120%); opacity: 0; }
  &.leaving-left { transform: translateX(-120%); opacity: 0; }
}

.st-card-link {
  color: inherit;
  display: block;
  text-decoration: none;
  /* The hold is ours: no iOS link preview, no image save menu, no text
     selection under the finger. */
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;

  img { -webkit-touch-callout: none; }
}

.st-poster {
  aspect-ratio: 2 / 3;
  background: #1c1c1c;
  display: block;
  object-fit: cover;
  width: 100%;
}

.st-poster-blank { font-size: 1.1rem; }

.st-poster-blank {
  align-items: center;
  color: #ddd;
  display: flex;
  font-size: 0.78rem;
  font-weight: 600;
  justify-content: center;
  padding: 0.5rem;
  text-align: center;
}

.st-tags {
  display: flex;
  gap: 0.25rem;
  left: 0.3rem;
  position: absolute;
  top: 0.3rem;
}

.st-tag {
  background: rgba(0, 0, 0, 0.75);
  border-radius: 3px;
  color: #eee;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.1rem 0.3rem;
  text-transform: uppercase;

  &.new { background: #ffc107; color: #000; }
  &.remind { background: #0d6efd; color: #fff; }
  &.reminded { background: rgba(13, 110, 253, 0.35); color: #cfe2ff; }
  &.tickets { background: #146c43; color: #fff; }
}

/* What a swipe is about to do, fading in with the drag. */
.st-swipe-hint {
  align-items: center;
  border-radius: 999px;
  color: #fff;
  display: flex;
  font-size: 0.85rem;
  font-weight: 700;
  gap: 0.35rem;
  opacity: 0;
  padding: 0.35rem 0.7rem;
  pointer-events: none;
  position: absolute;
  top: 45%;
  transition: opacity 0.05s linear;

  &.left { background: #0d6efd; right: 0.6rem; }
  &.right { background: #dc3545; left: 0.6rem; }
}

.st-toast {
  background: #2b2b2b;
  border: 1px solid #444;
  border-radius: 999px;
  bottom: 1.5rem;
  color: #fff;
  font-size: 0.85rem;
  left: 50%;
  max-width: 90vw;
  padding: 0.5rem 0.9rem;
  position: fixed;
  transform: translateX(-50%);
  z-index: 50;
}

.st-toast-enter-active, .st-toast-leave-active { transition: opacity 0.2s ease; }
.st-toast-enter-from, .st-toast-leave-to { opacity: 0; }

.st-caption {
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.9) 45%);
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  left: 0;
  padding: 1.6rem 0.7rem 0.55rem;
  position: absolute;
  right: 0;
}

.st-caption-title {
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-caption-when { color: #ccc; font-size: 0.78rem; }
.st-caption-also { color: #ffc107; font-size: 0.74rem; }

.st-dismiss {
  align-items: center;
  background: rgba(0, 0, 0, 0.7);
  border: 0;
  border-radius: 999px;
  color: #fff;
  display: flex;
  font-size: 0.95rem;
  height: 36px;
  justify-content: center;
  position: absolute;
  right: 0.4rem;
  top: 0.4rem;
  width: 36px;
}
.st-sheet {
  background: rgba(10, 10, 10, 0.94);
  border-top: 1px solid #2e2e2e;
  bottom: 0;
  left: 0;
  padding: 0.9rem 0.8rem 0.8rem;
  position: absolute;
  right: 0;
  z-index: 2;
}

.st-sheet-title {
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 0.7rem;
}

.st-sheet-buttons {
  display: flex;
  gap: 0.5rem;

  button {
    align-items: center;
    border-radius: 8px;
    display: inline-flex;
    flex: 1 1 0;
    font-weight: 700;
    gap: 0.4rem;
    justify-content: center;
    min-height: 44px;
  }
}

.st-sheet-cancel {
  background: #2b2b2b;
  border: 1px solid #444;
  color: #eee;

  &:active { background: #3a3a3a; }
}

.st-sheet-yes {
  background: #ffc107;
  border: 0;
  color: #111;

  &:active { background: #e0a800; }
}
</style>
