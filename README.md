# Listening Lens — Spotify Analyzer

A privacy-first, interactive Spotify listening analytics UI with local demo/import analysis and an architecture ready for a real Spotify OAuth + prediction backend.

## Run
Open `index.html` in a modern browser.

## Included
- Premium responsive dashboard
- Interactive Overview / Insights / Prediction / Security Center
- Demo dataset
- Spotify JSON/CSV local import
- Artist, genre, timeline and listening behavior visualizations
- Explainable prediction panel
- JSON report export
- Privacy/security UX
- No password collection

## Production Spotify integration
Do NOT add a form that asks users for their Spotify/Gmail password.

Use Spotify OAuth 2.0 Authorization Code + PKCE for a browser application. Request only the scopes your feature actually needs (for example, top items and recently played). Keep access/refresh tokens on the server where appropriate; do not put client secrets in browser code.

Recommended flow:
Browser -> Spotify OAuth + PKCE -> backend token exchange -> Spotify Web API -> sanitizer -> feature extraction -> prediction -> dashboard.

For imported Spotify Extended Streaming History, discard fields that are not required for analytics (for example IP address, user agent and other technical identifiers). Keep only the minimum analysis fields.

## Prediction
The current frontend demonstrates the prediction experience with deterministic demo values. For real predictions, connect the prediction panel to a backend model using features such as:
- artist/track affinity
- genre frequency and transitions
- time-of-day behavior
- recency and repeat rate
- discovery ratio
- session length
- skip behavior where available

Treat predictions as behavioral estimates. Do not present them as psychological or medical conclusions.

## Security checklist
- OAuth only; never request Spotify passwords
- Authorization Code + PKCE for browser apps
- Least-privilege scopes
- HTTPS in production
- Server-side secret storage
- Short-lived access tokens and secure refresh handling
- Avoid access tokens in URLs, analytics logs, or error reports
- Encrypt sensitive server-side storage
- Clear data on disconnect/delete
- Privacy policy and transparent data-use disclosure
- Do not sell Spotify-derived user data
- Rate-limit API endpoints
- Validate and sanitize imported files
- Restrict CORS to trusted origins
- Add CSRF protection where cookie-based sessions are used
- Log security events without logging tokens or raw listening history

## Important
The "Connect Spotify" button in this package is intentionally a secure UX placeholder. Add your Spotify app credentials and OAuth callback on a backend before enabling live account connection.
