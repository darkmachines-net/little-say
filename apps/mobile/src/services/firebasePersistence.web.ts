/** @file Configures Firebase browser sign-in with in-memory credentials until exchange for an HttpOnly backend cookie. */
import { inMemoryPersistence, browserPopupRedirectResolver } from 'firebase/auth';
/** Enable Firebase's browser popup flow and keep refresh state in memory. Reloads restore the server cookie. */
export function authDependencies() { return { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver }; }
