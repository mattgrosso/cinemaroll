<template>
  <div class="login">
    <h1 class="login-title">Welcome to Cinema Roll</h1>
    <p class="login-subtitle">Sign in to get to your library.</p>
    <p v-if="sessionExpired" class="login-session-expired" role="status">
      You were signed out. Please sign in again.
    </p>

    <div class="login-panel">
      <button
        type="button"
        class="provider-button google"
        :disabled="busy"
        @click="runAuth('loginWithGoogle')"
      >
        <i class="bi bi-google"></i>
        Continue with Google
      </button>

      <button
        v-if="showAppleSignIn"
        type="button"
        class="provider-button apple"
        :disabled="busy"
        @click="runAuth('loginWithApple')"
      >
        <i class="bi bi-apple"></i>
        Continue with Apple
      </button>

      <div class="divider"><span>or</span></div>

      <form class="email-form" @submit.prevent="submitEmailForm">
        <label class="field-label" for="login-email">Email</label>
        <input
          id="login-email"
          v-model="email"
          class="login-input"
          type="email"
          autocomplete="email"
          inputmode="email"
          :disabled="busy"
          required
        >

        <template v-if="mode !== 'reset'">
          <label class="field-label" for="login-password">Password</label>
          <input
            id="login-password"
            v-model="password"
            class="login-input"
            type="password"
            :autocomplete="mode === 'signUp' ? 'new-password' : 'current-password'"
            :disabled="busy"
            required
          >
        </template>

        <template v-if="mode === 'signUp'">
          <label class="field-label" for="login-confirm">Confirm password</label>
          <input
            id="login-confirm"
            v-model="confirmPassword"
            class="login-input"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
            required
          >
        </template>

        <button type="submit" class="submit-button" :disabled="busy">
          {{ submitLabel }}
        </button>
      </form>

      <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>
      <p v-if="noticeMessage" class="login-notice" role="status">{{ noticeMessage }}</p>

      <div class="mode-links">
        <button v-if="mode !== 'signIn'" type="button" class="link-button" :disabled="busy" @click="setMode('signIn')">
          Sign in with an existing account
        </button>
        <button v-if="mode !== 'signUp'" type="button" class="link-button" :disabled="busy" @click="setMode('signUp')">
          Create a new account
        </button>
        <button v-if="mode !== 'reset'" type="button" class="link-button" :disabled="busy" @click="setMode('reset')">
          Forgot your password?
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { friendlyAuthError, CANCELLED_CODES } from '../assets/javascript/authErrors.js';
import { takeSessionExpired } from '../utils/sessionExpiredNotice.js';

export default {
  data () {
    return {
      mode: 'signIn', // 'signIn' | 'signUp' | 'reset'
      email: '',
      password: '',
      confirmPassword: '',
      busy: false,
      errorMessage: '',
      noticeMessage: '',
      // Set when the app signed you out because Firebase no longer had your
      // session (password changed, signed out elsewhere, long time away).
      sessionExpired: takeSessionExpired()
    };
  },
  computed: {
    // Sign in with Apple can't just be switched on in the Firebase console —
    // it also needs a paid Apple Developer account and a configured Service ID.
    // Gating on an env var means the button doesn't appear (and dead-end on
    // `auth/operation-not-allowed`) until that setup is actually finished.
    showAppleSignIn () {
      return process.env.VUE_APP_ENABLE_APPLE_SIGNIN === 'true';
    },
    submitLabel () {
      if (this.busy) return 'Working...';
      if (this.mode === 'signUp') return 'Create account';
      if (this.mode === 'reset') return 'Send reset link';
      return 'Sign in';
    },
    // Firebase keys the account by whatever string it's given, so `Matt@x.com`
    // and `matt@x.com` would become two separate accounts pointing at two
    // separate libraries. Normalizing here keeps new sign-ups consistent.
    // (The key derivation itself deliberately does NOT lowercase — doing so
    // would re-key existing accounts. See databaseKey.js.)
    normalizedEmail () {
      return this.email.trim().toLowerCase();
    }
  },
  mounted () {
    // Automated-testing sign-in: /#/login?testToken=<custom token> (minted
    // by scripts/mint-test-token.mjs for the dedicated tester account —
    // see the store action for why this can't reach real accounts).
    const testToken = this.$route?.query?.testToken;
    if (testToken) {
      this.busy = true;
      this.$store.dispatch('loginWithTestToken', testToken)
        .then(() => this.$router.push('/'))
        .catch((error) => {
          this.errorMessage = friendlyAuthError(error);
          this.busy = false;
        });
    }
  },
  methods: {
    setMode (mode) {
      this.mode = mode;
      this.errorMessage = '';
      this.noticeMessage = '';
    },
    async runAuth (action, payload) {
      this.busy = true;
      this.errorMessage = '';
      this.noticeMessage = '';

      try {
        await this.$store.dispatch(action, payload);
      } catch (error) {
        // Closing the Google/Apple popup isn't an error worth shouting about,
        // but the form still has to come out of its busy state.
        if (!CANCELLED_CODES.includes(error?.code)) {
          this.errorMessage = friendlyAuthError(error);
        }
      } finally {
        this.busy = false;
      }
    },
    async submitEmailForm () {
      if (this.mode === 'reset') {
        await this.runAuth('sendPasswordReset', this.normalizedEmail);
        if (!this.errorMessage) {
          // Deliberately worded so it reads the same whether or not an account
          // exists — confirming which emails are registered would leak that.
          this.noticeMessage = `If an account exists for ${this.normalizedEmail}, a reset link is on its way.`;
        }
        return;
      }

      if (this.mode === 'signUp') {
        if (this.password !== this.confirmPassword) {
          this.errorMessage = "Those passwords don't match.";
          return;
        }
        await this.runAuth('signUpWithEmail', { email: this.normalizedEmail, password: this.password });
        return;
      }

      await this.runAuth('loginWithEmail', { email: this.normalizedEmail, password: this.password });
    }
  }
}
</script>

<style lang="scss" scoped>
  // The page sits on <body class="bg-dark">, and nothing sets a global text
  // colour — Bootstrap's default body colour is near-black, so every colour
  // here is set explicitly rather than inherited. (The old version of this
  // screen relied on that inheritance and was genuinely low-contrast.)
  .login {
    color: #eee;
    margin: 8vh auto 4rem;
    max-width: 380px;
    padding: 0 1.25rem;
  }

  .login-title {
    font-size: 1.6rem;
    margin-bottom: 0.25rem;
    text-align: center;
  }

  .login-subtitle {
    color: #adb5bd;
    font-size: 0.9rem;
    margin-bottom: 1.75rem;
    text-align: center;
  }

  // Sits between the subtitle and the panel, so pull the subtitle's gap up.
  .login-session-expired {
    color: #ffd27f;
    font-size: 0.9rem;
    margin: -1rem 0 1.75rem;
    text-align: center;
  }

  .provider-button {
    align-items: center;
    border: none;
    border-radius: 6px;
    display: flex;
    font-size: 0.95rem;
    font-weight: 600;
    gap: 0.6rem;
    justify-content: center;
    margin-bottom: 0.6rem;
    padding: 0.7rem;
    width: 100%;

    // Mobile-first: press feedback only, no :hover (see CLAUDE.md).
    &:active:not(:disabled) {
      transform: scale(0.98);
    }

    &:disabled {
      opacity: 0.55;
    }
  }

  .provider-button.google {
    background: #fff;
    color: #1f1f1f;
  }

  .provider-button.apple {
    background: #000;
    border: 1px solid #555;
    color: #fff;
  }

  .divider {
    align-items: center;
    color: #777;
    display: flex;
    font-size: 0.8rem;
    gap: 0.75rem;
    margin: 1.25rem 0;

    &::before,
    &::after {
      background: #444;
      content: '';
      flex: 1;
      height: 1px;
    }
  }

  .email-form {
    display: flex;
    flex-direction: column;
  }

  .field-label {
    color: #adb5bd;
    font-size: 0.8rem;
    margin-bottom: 0.25rem;
  }

  .login-input {
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #eee;
    margin-bottom: 0.9rem;
    padding: 0.6rem 0.7rem;

    &:focus {
      border-color: #f0ad4e;
      outline: none;
    }

    &:disabled {
      opacity: 0.55;
    }
  }

  .submit-button {
    background: linear-gradient(180deg, #f0ad4e, #d9942f);
    border: none;
    border-radius: 6px;
    color: #1f1f1f;
    font-weight: 700;
    margin-top: 0.25rem;
    padding: 0.7rem;

    &:active:not(:disabled) {
      transform: scale(0.98);
    }

    &:disabled {
      opacity: 0.55;
    }
  }

  // #ff8a8a / #8fd19e rather than Bootstrap's .text-danger / .text-success,
  // both of which are too dark to read against this background.
  .login-error {
    color: #ff8a8a;
    font-size: 0.85rem;
    margin: 1rem 0 0;
  }

  .login-notice {
    color: #8fd19e;
    font-size: 0.85rem;
    margin: 1rem 0 0;
  }

  .mode-links {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }

  .link-button {
    background: none;
    border: none;
    color: #7fb3ff;
    font-size: 0.85rem;
    padding: 0;
    text-align: center;

    &:disabled {
      opacity: 0.55;
    }
  }
</style>
