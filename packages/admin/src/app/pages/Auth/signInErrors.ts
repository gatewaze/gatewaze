// The session holder sends a failed sign-in back as ?error=. Anyone can craft
// that link, so the page never renders the raw value: known codes map to
// fixed messages and anything else (including the free text older session
// holders send) gets the generic one.
/** One wording for "the session holder could not answer", wherever it is shown. */
export const SIGN_IN_UNAVAILABLE_MESSAGE = "Sign-in is temporarily unavailable. Please try again.";

const SIGN_IN_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled or denied.",
  login_failed: "Sign-in did not complete. Please try again.",
  callback_invalid: "Your sign-in link expired or was already used. Please try again.",
  not_admin: "Your account does not have admin access.",
  server_error: SIGN_IN_UNAVAILABLE_MESSAGE,
};
const GENERIC_SIGN_IN_ERROR = "Sign-in failed. Please try again.";

export function signInErrorMessage(code: string): string {
  return Object.prototype.hasOwnProperty.call(SIGN_IN_ERROR_MESSAGES, code)
    ? SIGN_IN_ERROR_MESSAGES[code]
    : GENERIC_SIGN_IN_ERROR;
}
