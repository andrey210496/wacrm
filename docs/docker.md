# Running with Docker

The repo ships a multi-stage `Dockerfile` (Next.js standalone output,
runs as a non-root user) and a `docker-compose.yml` with a single
`app` service. Supabase is external — point the app at your hosted
(or self-hosted) Supabase project via env vars; no database container
is included.

## Quick start

1. Copy the env template and fill it in:

   ```bash
   cp .env.local.example .env.local
   ```

2. Build and start (the `--env-file` flag is required — Compose only
   reads `.env` by default for `${VAR}` substitution, and this project
   keeps its config in `.env.local`):

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

3. The app is served on [http://localhost:3000](http://localhost:3000)
   (publish it elsewhere with `HOST_PORT=8080` in `.env.local`).

> Use `HOST_PORT`, not `PORT`, to move the published port. `PORT` is
> what the server listens on _inside_ the container, and `env_file`
> would inject it there — leaving the app on a port the mapping and
> the healthcheck don't target. Compose pins it to 3000 for that
> reason.

## Build-time vs runtime variables

- `NEXT_PUBLIC_*` variables are **inlined into the client bundle at
  build time**. They are passed as Docker build args by
  `docker-compose.yml`. If you change any of them, rebuild:
  `docker compose --env-file .env.local up --build -d`.
- Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, …) is read at **runtime** from `.env.local` via
  `env_file` and is never baked into the image — safe to change with
  just a container restart.

## Plain Docker (no Compose)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t wacrm .

docker run -d --env-file .env.local -e PORT=3000 -p 3000:3000 wacrm
```

## EasyPanel (SILO — one instance per client)

This app deploys **SILO**: one running instance + one Supabase/Postgres
project **per client**, no shared `tenant_id`. There is no cross-client
multi-tenancy in the app itself — isolation comes from each client
getting their own app service and their own database, not from a row
filter. See `docs/superpowers/specs/2026-09-02-usa-i-crm-multiunidade-sp1-design.md`
for the full design and `docs/contracts/license-v1.md` for the
control-plane contract this instance speaks.

For each client:

1. **Create a dedicated Supabase project** for that client and run the
   migrations under `supabase/` against it (Supabase CLI — the
   container does not run migrations, see Notes below).
2. **Create one EasyPanel app service** from this repo/image, dedicated
   to that client. Do not point two clients at the same service —
   there is no tenant isolation below the service boundary.
3. **Build args** (baked into the client bundle, so one image build is
   specific to one client's Supabase project — see "Build-time vs
   runtime variables" above):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` (the client's custom domain, e.g.
     `https://crm.clientname.com`)
   - `NEXT_PUBLIC_APP_LOCALE`
4. **Runtime secrets**, set in the EasyPanel service's environment
   panel (never baked into the image):
   - `SUPABASE_SERVICE_ROLE_KEY` — that client's service-role key.
   - `ENCRYPTION_KEY` — unique per instance; generate with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
     Do not reuse across clients — rotating it orphans every WhatsApp
     token encrypted under the old key.
   - `META_APP_SECRET` (and `META_APP_ID` if the client submits
     image-header templates) — that client's Meta app credentials.
   - `LICENSE_CONTROL_SECRET` — shared secret this instance expects on
     `POST /api/license/apply` (`x-license-secret` header). Generate
     per instance with `openssl rand -hex 32` and give the same value
     to the SP2 control plane for that client.
   - `SIGNUP_DISABLED=true` — closes self-serve signup. SILO instances
     are provisioned by the operator (create the client's first/owner
     account directly in Supabase or via one manual signup before
     flipping this on), not self-signed-up for. Internal invites
     (`owner`/`admin` → `admin`/`agent`/`viewer` via `/join/<token>`)
     keep working regardless — see `.env.local.example`.

     **This only closes the app's own signup page.** The client SDK
     calls Supabase GoTrue directly, so an attacker can still register
     via Supabase's `/auth/v1/signup` endpoint even with this set. To
     truly prevent account creation you MUST ALSO disable signups at the
     Supabase project level: **Authentication → Providers/Settings →
     disable email signups**. Do both on every SILO deploy.
5. **Healthcheck**: point EasyPanel's healthcheck at `/` (the same
   check `docker-compose.yml` uses — `GET /` expecting a non-5xx
   response) on the container's port `3000`.
6. **Custom domain + TLS**: attach the client's domain in EasyPanel and
   let it provision a Let's Encrypt certificate. Set
   `NEXT_PUBLIC_SITE_URL` (build arg, step 3) to that same domain
   before the build that ships it.
7. **Deploy windows**: every deploy restarts the app container — there
   is a few-seconds gap where requests 502 while the new container
   comes up (no rolling/zero-downtime restart on a single-service
   EasyPanel app). Publish in low-traffic windows per client, and
   batch multiple small changes into one deploy rather than deploying
   each commit separately.

## Notes

- Database migrations under `supabase/` are **not** run by the
  container — apply them with the Supabase CLI as described in the
  README.
- Received attachments are copied into the `chat-media` Supabase
  Storage bucket, because Meta deletes media roughly 30 days after it
  arrives and the copy is the only thing that outlives that. It grows
  with inbound volume, so it's worth watching your project's storage
  quota. Turn it off per account under Settings → WhatsApp →
  Attachment Storage; attachments received while it's off become
  unviewable once Meta drops them. Files over 16 MB (the bucket's
  limit) are never copied.
- Nothing inside the container is scheduled. If you use automation
  Wait steps or flows, point an external scheduler at
  `GET /api/automations/cron` and `GET /api/flows/cron` on this
  deployment, sending the shared secret in the `x-cron-secret` header
  (`AUTOMATION_CRON_SECRET`, see `.env.local.example`). Both return
  503 until that variable is set.
