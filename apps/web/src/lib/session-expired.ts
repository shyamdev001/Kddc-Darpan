/**
 * Sends the browser to sign-in after the API answers 401. A full page load (not router.push)
 * is deliberate: it drops every bit of client state that belonged to the old session.
 */
export function goToSignInExpired(): void {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload is intended
  window.location.assign("/login?expired=1");
}
