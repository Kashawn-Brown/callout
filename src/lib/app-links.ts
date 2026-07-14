/**
 * Outward-facing links that exist independent of any session or token.
 *
 * APP_DOWNLOAD_URL backs the profile screen's share action (D066): a plain, static pointer to where someone gets the app. No store listing exists yet, so it points at the project's repository as the placeholder D066 anticipates — swap this for the real store listing link at release (the same open item as D053's store fallback).
 */
export const APP_DOWNLOAD_URL = 'https://github.com/Kashawn-Brown/callout';
