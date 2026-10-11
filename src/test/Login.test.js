import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Login from '@/components/Login.vue'

function mountLogin (dispatch = vi.fn()) {
  return {
    dispatch,
    wrapper: mount(Login, { global: { mocks: { $store: { dispatch } } } })
  }
}

async function fillEmailForm (wrapper, { email, password, confirm } = {}) {
  if (email !== undefined) await wrapper.find('#login-email').setValue(email)
  if (password !== undefined) await wrapper.find('#login-password').setValue(password)
  if (confirm !== undefined) await wrapper.find('#login-confirm').setValue(confirm)
}

describe('Login', () => {
  afterEach(() => {
    delete process.env.VUE_APP_ENABLE_APPLE_SIGNIN
  })

  describe('signed out because the session ended', () => {
    afterEach(() => window.sessionStorage.clear())

    it('says so, once, instead of looking like a crash', () => {
      window.sessionStorage.setItem('cinemaRoll.sessionExpired', '1')
      expect(mountLogin().wrapper.find('.login-session-expired').text()).toContain('You were signed out')
      expect(mountLogin().wrapper.find('.login-session-expired').exists()).toBe(false)
    })

    it('stays quiet on an ordinary visit', () => {
      expect(mountLogin().wrapper.find('.login-session-expired').exists()).toBe(false)
    })
  })

  describe('Google', () => {
    it('renders a Google button and dispatches loginWithGoogle', async () => {
      const { wrapper, dispatch } = mountLogin()

      expect(wrapper.text()).toContain('Continue with Google')
      await wrapper.find('.provider-button.google').trigger('click')

      expect(dispatch).toHaveBeenCalledWith('loginWithGoogle', undefined)
    })
  })

  describe('Apple', () => {
    it('is hidden until the env flag is set, so nobody taps a button that cannot work yet', () => {
      const { wrapper } = mountLogin()
      expect(wrapper.find('.provider-button.apple').exists()).toBe(false)
    })

    it('appears and dispatches loginWithApple once enabled', async () => {
      process.env.VUE_APP_ENABLE_APPLE_SIGNIN = 'true'
      const { wrapper, dispatch } = mountLogin()

      expect(wrapper.find('.provider-button.apple').exists()).toBe(true)
      await wrapper.find('.provider-button.apple').trigger('click')

      expect(dispatch).toHaveBeenCalledWith('loginWithApple', undefined)
    })
  })

  describe('email and password', () => {
    it('signs in with the typed credentials', async () => {
      const { wrapper, dispatch } = mountLogin()

      await fillEmailForm(wrapper, { email: 'someone@example.com', password: 'hunter22' })
      await wrapper.find('.email-form').trigger('submit')

      expect(dispatch).toHaveBeenCalledWith('loginWithEmail', {
        email: 'someone@example.com',
        password: 'hunter22'
      })
    })

    it('lowercases and trims the email so one address cannot become two accounts', async () => {
      const { wrapper, dispatch } = mountLogin()

      await fillEmailForm(wrapper, { email: '  SomeOne@Example.COM ', password: 'hunter22' })
      await wrapper.find('.email-form').trigger('submit')

      expect(dispatch).toHaveBeenCalledWith('loginWithEmail', {
        email: 'someone@example.com',
        password: 'hunter22'
      })
    })

    it('creates an account in sign-up mode', async () => {
      const { wrapper, dispatch } = mountLogin()

      await wrapper.findAll('.link-button').find((b) => b.text().includes('Create')).trigger('click')
      await fillEmailForm(wrapper, { email: 'new@example.com', password: 'hunter22', confirm: 'hunter22' })
      await wrapper.find('.email-form').trigger('submit')

      expect(dispatch).toHaveBeenCalledWith('signUpWithEmail', {
        email: 'new@example.com',
        password: 'hunter22'
      })
    })

    it('refuses to sign up when the confirmation does not match', async () => {
      const { wrapper, dispatch } = mountLogin()

      await wrapper.findAll('.link-button').find((b) => b.text().includes('Create')).trigger('click')
      await fillEmailForm(wrapper, { email: 'new@example.com', password: 'hunter22', confirm: 'hunter23' })
      await wrapper.find('.email-form').trigger('submit')

      expect(dispatch).not.toHaveBeenCalled()
      expect(wrapper.find('.login-error').text()).toContain("don't match")
    })
  })

  describe('password reset', () => {
    it('sends a reset and reports back without confirming whether the account exists', async () => {
      const { wrapper, dispatch } = mountLogin()

      await wrapper.findAll('.link-button').find((b) => b.text().includes('Forgot')).trigger('click')
      // The password field is not rendered in reset mode.
      expect(wrapper.find('#login-password').exists()).toBe(false)

      await fillEmailForm(wrapper, { email: 'forgot@example.com' })
      await wrapper.find('.email-form').trigger('submit')
      await wrapper.vm.$nextTick()

      expect(dispatch).toHaveBeenCalledWith('sendPasswordReset', 'forgot@example.com')
      expect(wrapper.find('.login-notice').text()).toContain('If an account exists')
    })
  })

  describe('errors', () => {
    it('shows a readable message when sign-in fails', async () => {
      const dispatch = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/invalid-credential' }))
      const { wrapper } = mountLogin(dispatch)

      await fillEmailForm(wrapper, { email: 'a@b.com', password: 'wrong' })
      await wrapper.find('.email-form').trigger('submit')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.login-error').text()).toContain("don't match an account")
      // Must not stay stuck on "Working..." after a failure.
      expect(wrapper.vm.busy).toBe(false)
    })

    it('stays quiet when the user just closes the provider popup, but still un-busies', async () => {
      const dispatch = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' }))
      const { wrapper } = mountLogin(dispatch)

      await wrapper.find('.provider-button.google').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.login-error').exists()).toBe(false)
      expect(wrapper.vm.busy).toBe(false)
    })

    it('clears a previous error when switching modes', async () => {
      const dispatch = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/invalid-credential' }))
      const { wrapper } = mountLogin(dispatch)

      await fillEmailForm(wrapper, { email: 'a@b.com', password: 'wrong' })
      await wrapper.find('.email-form').trigger('submit')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.login-error').exists()).toBe(true)

      await wrapper.findAll('.link-button').find((b) => b.text().includes('Create')).trigger('click')
      expect(wrapper.find('.login-error').exists()).toBe(false)
    })
  })
})
