/**
 * The pages' Content-Security-Policy: everything from the site itself, no inline scripts, no plugins, no forms, no
 * framing. Inline styles are allowed (the slides size things with style="--len:…"); images may be data: or blob: (the
 * paper grain, saved images, the maker's photos). site/vercel.json sends it on the website (a test checks they match).
 */
export const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** The local maker (src/app/server.ts): the same, except it frames its own preview of the wrap. */
export const MAKER_CSP = SITE_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'")
