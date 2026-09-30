import axios from 'axios';
import { getAuth } from 'firebase/auth';

// The Letterboxd routes live in the newsletter Lambda (aws-lambda/letterboxd.js
// explains why), behind the same Firebase-ID-token gate as every other
// endpoint. `route` is '/sync' or '/film'.
export async function postToLetterboxd (route, payload = {}) {
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error('Not signed in — the Letterboxd sync needs an authenticated user.');
  }
  if (!process.env.VUE_APP_NEWSLETTER_API_URL) {
    throw new Error('No Letterboxd endpoint configured.');
  }

  const idToken = await user.getIdToken();

  return axios.post(`${process.env.VUE_APP_NEWSLETTER_API_URL}/letterboxd${route}`, payload, {
    timeout: 28000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    }
  });
}
