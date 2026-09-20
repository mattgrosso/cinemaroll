import axios from 'axios';
import { getAuth } from 'firebase/auth';

// The newsletter Lambda's HTTP half — the devMode rebuild, and nothing else.
// The weekly issue arrives without anyone asking, so this is the ONLY route a
// client ever calls.
//
// Same gate as utils/aiRequest.js and utils/push.js: the endpoint verifies a
// Firebase ID token, because its URL ships in the public bundle and a rebuild
// spends a frontier-model call. CORS is not the gate — it only constrains
// browsers. This is the one place that attaches the token, so no caller can
// forget.
export async function postToNewsletter (route, payload) {
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error('Not signed in — the newsletter needs an authenticated user.');
  }
  if (!process.env.VUE_APP_NEWSLETTER_API_URL) {
    throw new Error('No newsletter endpoint configured.');
  }

  const idToken = await user.getIdToken();

  return axios.post(`${process.env.VUE_APP_NEWSLETTER_API_URL}${route}`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    }
  });
}
