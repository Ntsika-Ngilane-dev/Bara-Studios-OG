# Bara Studios admin dashboard

The admin area is a separate, owner-only workspace at `/admin`. An Admin login button in the public site's footer opens the sign-in page; after a successful sign-in, the dashboard opens. It uses a Node.js server and a local SQLite database. The database starts empty; no client records or sample customer data are inserted. The website enquiry form submits to the server and new messages appear in the Enquiries and Alerts sections.

## Run locally

1. Install Node.js 22.5 or later.
2. From the project folder, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set a unique `ADMIN_EMAIL` and a long `ADMIN_PASSWORD` (at least 16 characters). Keep `.env` private.
5. Run `npm start` and open `http://localhost:8001/admin`.

Local development uses SQLite unless `DATABASE_URL` or `POSTGRES_URL` is set. The initial reporting currency is ZAR. Change it in the Store section using a three-letter ISO currency code. Currency changes do not convert existing amounts, so keep a single currency for consistent reporting.

The Store section records products and sales entered by the admin; it does not process payments or connect to a third-party storefront. The Suppliers section supports itemized custom orders and status tracking. Client service prices and sales are displayed as recorded amounts.

## Deploy on Vercel

The repository includes a Vercel Node.js function for `/api/*`, a rewrite for `/admin`, and response security headers. Vercel deployments require a Neon PostgreSQL database; the local SQLite file is not used by Vercel Functions.

1. Import the repository into Vercel and use the repository root as the project root. Vercel will install the npm dependencies and serve the root HTML, CSS, JavaScript, and image files.
2. Create a Neon PostgreSQL database through the Vercel Marketplace and add its pooled connection string as `DATABASE_URL` in the Vercel project's Environment Variables for Preview and Production.
3. Add `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 16 characters), and `CURRENCY` to those same environments. Set a unique production password; never commit `.env` or paste secrets into source files.
4. Add optional alert-provider variables from `.env.example` if you want external notifications.
5. Deploy. The API initializes its PostgreSQL tables and default service rows on its first request. Use `/admin` to sign in.

Vercel uses its own `PORT`; do not set a fixed port in the Vercel project. The local `data/bara-studios.sqlite` database is not copied to Neon, so production data starts empty unless separately migrated. Configure a Neon backup/restore policy before entering production client data.

## Alerts

In-app notifications work without external accounts. For browser push, generate VAPID keys with `npx web-push generate-vapid-keys`, place the public and private keys and a `VAPID_SUBJECT` in the server environment, then enable push from the Alerts section.

Email alerts use Resend (`RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ADMIN_ALERT_EMAIL`). SMS and WhatsApp alerts use Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, the relevant `TWILIO_*_FROM` value, and the admin destination). WhatsApp also needs an approved template ID in `TWILIO_WHATSAPP_CONTENT_SID`; its first template variable receives a generic alert without customer details. External alerts are sent only for enquiries whose message contains a recognized urgency term, and only when that channel is configured. No voice calls are enabled. Provider credentials are never included in browser code.

## Data and deployment

Client and enquiry data are private records. The API requires the owner session and a CSRF token for changes; admin and API responses are marked `no-store`, and the service worker bypasses admin and API paths. The AI assistant is disabled, and no client data is sent to an LLM.

The SQLite database is stored at `DATABASE_PATH` (default `./data/bara-studios.sqlite`). Back up this file securely. For public deployment, use a persistent server host, HTTPS, protected environment secrets, restricted server access, and a tested backup/restore process. Set `NODE_ENV=production` behind an HTTPS-terminating host; admin writes reject non-HTTPS origins in production.

Run the focused checks with `npm test`.
