// VENDOR CSS FIRST, AND IT HAS TO STAY THERE. Vite emits stylesheets in
// module-graph order, so whatever is imported first ends up EARLIEST in
// app.css — and between two rules of equal specificity, the later one wins.
// These imports used to sit below `App.vue`, which put Bootstrap's own
// `body { font-family: var(--bs-body-font-family) }` after App.vue's
// `body { font-family: "Roboto Condensed" }` and silently reverted the whole
// app to the system font stack. Bug report, 2026-09-14: "Did the font change
// for some reason on our notifications... our alert banner looks different."
// Vue CLI extracted vendor CSS into its own file and loaded it first, which
// is why the order never had to be thought about before the Vite move; this
// restores that arrangement explicitly. `cssImportOrder.test.js` guards it.
import "bootstrap/dist/css/bootstrap.min.css";
import 'bootstrap-icons/font/bootstrap-icons.css';
import "bootstrap";

import { createApp } from "vue";
import App from "./App.vue";
import store from "./store";
import router from './router';
import VueClickAway from "vue3-click-away";
import * as Sentry from "@sentry/vue";
import { BrowserTracing } from "@sentry/tracing";
import VueLazyLoad from 'vue3-lazyload';
import './registerServiceWorker'

const app = createApp(App);

app.use(store);

// Movie Hat is a separate Firebase project with its own session. Watching it
// from start-up is what makes the connection survive a reload — otherwise the
// settings pane would offer to connect an account that is already connected.
store.dispatch('watchMovieHatAuth');

app.use(VueClickAway);

// rootMargin grows the IntersectionObserver's trigger zone so posters start
// loading ~1.5 screens before they scroll into view — on a normal scroll the
// image is already decoded by the time it appears, so the placeholder is
// effectively never seen. (Default is "0px", which only loads on entry and
// flashes the placeholder during fast scrolls.)
app.use(VueLazyLoad, {
  observerOptions: {
    rootMargin: '1200px 0px',
    threshold: 0,
  },
});

app.use(router);

// Sentry

const allowDevSentry = false;

if (allowDevSentry || process.env.NODE_ENV !== "development") {
  Sentry.init({
    app,
    dsn: "https://25a3dc0387f04fd5923f226394a41e7d@o4504483013525504.ingest.sentry.io/4504642713944064",
    integrations: [
      new BrowserTracing({
        tracePropagationTargets: ["localhost", "surge", /^\//],
      }),
    ],
    tracesSampleRate: 1.0,
    sampleRate: 1.0,
    maxValueLength: 8000
  });
}

app.mount("#app");
