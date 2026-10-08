/** @file Keeps browser Firebase sign-in credentials in memory until exchange for an HttpOnly backend cookie. */
import { inMemoryPersistence, browserPopupRedirectResolver } from 'firebase/auth';
/** Browser reloads restore the server cookie, never a JavaScript refresh token. */
export function authPersistence() { return inMemoryPersistence; }
/** Enable Firebase's browser popup flow while keeping all refresh state in memory. */
export function authDependencies() { return { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver }; }
