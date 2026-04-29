# DEPLOY-MULTIBRAND — Coolify multi-subdomain deployment for the panel

This document describes how `nixbot-saas-ui` is deployed once on Coolify and
serves multiple branded subdomains (`app.nixbot.com`, `app.phonepilot.com`, …)
from the same container. Per-brand theming/copy/logos are resolved at runtime
inside the Svelte build from `window.location.host` (see `src/lib/brand.ts`),
so no per-brand artifact is needed — a single image serves every brand.

The architecture invariant from `MULTI_PRODUCT_PLATFORM_PRD.md`:

> One Postgres, one binary, one Svelte panel deploy. Brands are subdomains
> served by the same Coolify deployment via Traefik (multiple domains in the
> panel app's Domains field, one Let's Encrypt cert per host).

---

## Prerequisites

- Coolify v4 instance (this project uses `https://paas.linkgate.bio`).
- The `nixbot-saas-ui` application already created in the `AndroidAuto`
  Coolify project, with GitHub auto-deploy wired (see `nixbot/COOLIFY.md` for
  API and credentials reference).
- Each brand owns its own apex domain (`nixbot.com`, `phonepilot.com`) with DNS
  managed in a place we can edit (Cloudflare, Route 53, etc.).

---

## How multi-subdomain works on Coolify

Coolify provisions a single Traefik instance in front of every application.
The application's **Domains** field is the comma-separated list of hostnames
Traefik should route to that container. Coolify will:

1. Add a Traefik router rule per host.
2. Request a Let's Encrypt certificate per host (HTTP-01 challenge by default,
   so each host must publicly resolve to the Coolify edge before issuance can
   succeed).
3. Forward inbound traffic on every host to the container's exposed port.

Because the panel renders the brand based on `window.location.host`, no
per-host configuration inside Coolify is required beyond listing the host in
**Domains**.

---

## Configuration

### 1. DNS

For every brand, create an `A` record (or `AAAA` if IPv6) pointing the panel
subdomain to the Coolify server's public IP. Disable any proxying / orange
cloud (Cloudflare's proxied mode) before issuance — Let's Encrypt's HTTP-01
challenge needs a direct path to the Coolify edge. Once the certificate is
issued, proxying can be re-enabled if desired.

| Host                 | Type | Value                  | Notes                        |
|----------------------|------|------------------------|------------------------------|
| `app.nixbot.com`     | A    | `<coolify-server-ip>`  | TTL 300 while iterating      |
| `app.phonepilot.com` | A    | `<coolify-server-ip>`  | TTL 300 while iterating      |

Verify before continuing:

```bash
dig +short app.nixbot.com
dig +short app.phonepilot.com
# both must return the Coolify server IP
```

### 2. Coolify application fields

In the Coolify UI, open the panel application and set:

| Field                         | Value                                            |
|-------------------------------|--------------------------------------------------|
| **Domains**                   | `https://app.nixbot.com,https://app.phonepilot.com` |
| **Ports Exposes**             | `80`                                             |
| **Build Pack**                | `Dockerfile`                                     |
| **Dockerfile Location**       | `/Dockerfile`                                    |
| **Direction**                 | HTTP (Traefik handles TLS termination)           |
| **Force HTTPS Redirect**      | `On`                                             |
| **Health Check Path**         | `/healthz`                                       |

Notes:

- `Domains` is comma-separated, `https://` scheme on each entry tells Coolify
  to provision a Let's Encrypt cert for that host.
- `Ports Exposes = 80` matches `EXPOSE 80` in the panel's `Dockerfile`; the
  `nginx.conf` listens on 80 with `default_server`, so any host header is
  accepted and served the same SPA bundle.
- `/healthz` returns 200 (see `nginx.conf`); Coolify uses it to gate restarts.

After editing, click **Save** and then **Redeploy** so Traefik picks up the
new router rules.

### 3. Verify

```bash
curl -I https://app.nixbot.com/healthz
# HTTP/2 200, server: nginx, x-content-type-options: nosniff
curl -I https://app.phonepilot.com/healthz
# HTTP/2 200
```

In a browser, `app.nixbot.com` should render the nixbot brand (logo, colors,
copy from `src/lib/brand.ts`) and `app.phonepilot.com` should render the
phonepilot brand. Different `data-brand` attribute on `<html>` is the
quickest visual confirmation.

---

## Adding a new brand

The full lifecycle to onboard a third brand `examplebrand` after the panel
already supports two:

1. **Code** — extend the brand registry in the panel:
   - Add a `BRANDS['app.examplebrand.com']` entry to `src/lib/brand.ts` with
     the brand's `code`, `name`, `logoPath`, colors, `primaryProductCode`, and
     any `copyOverrides`.
   - Drop the brand's logo at `public/brands/examplebrand/logo.svg`.
   - Commit, push, let Coolify auto-deploy.
2. **DNS** — create an `A` record `app.examplebrand.com → <coolify-server-ip>`
   on the brand's apex domain, with proxying disabled until the cert issues.
3. **Coolify** — open the panel application, append `https://app.examplebrand.com`
   to **Domains** (comma-separated), **Save**, **Redeploy**.
4. **Verify** — `curl -I https://app.examplebrand.com/healthz` returns 200 and
   the browser shows the new brand's theme.
5. (Optional) Re-enable any provider proxying / CDN once the certificate has
   been issued.

This is purely additive: existing brands are unaffected, and the SPA bundle
itself only changed by a static config addition.

---

## Removing a brand

1. Remove `https://app.<brand>.com` from the **Domains** field in Coolify.
2. Click **Redeploy** so Traefik drops the router and stops renewing the cert.
3. (Optional) Delete the DNS record once you're sure no traffic is in flight.
4. (Optional) Delete the entry from `src/lib/brand.ts` and the asset from
   `public/brands/<code>/`. Leaving the entry in is harmless — without DNS +
   Domains there's no way to reach it.

---

## Troubleshooting

### SSL certificate not issued for a new brand

Symptoms: `https://app.<brand>.com` shows a `TRAEFIK DEFAULT CERT` /
`ERR_CERT_AUTHORITY_INVALID` warning, or `curl -I` returns a 404 from
Traefik's default catch-all.

Checklist:

1. **DNS not yet propagated.** `dig +short app.<brand>.com` must return the
   Coolify server's public IP from a public resolver (e.g.
   `dig @1.1.1.1 +short app.<brand>.com`). If empty or wrong, fix DNS and
   wait the TTL.
2. **Cloudflare / CDN proxying enabled.** Switch to "DNS only" (grey cloud)
   for the issuance window — Let's Encrypt HTTP-01 needs a direct path.
3. **Domain not redeployed.** Adding to **Domains** without **Redeploy** is
   the most common cause; Traefik only re-reads the router config on deploy.
4. **Rate-limited by Let's Encrypt.** If you've added/removed the host more
   than ~5 times in a week, you may be in the LE rate-limit window. Wait, or
   request a staging cert, or use a different subdomain.
5. **Port 80 blocked at the firewall.** HTTP-01 needs inbound port 80 to the
   Coolify host. Check provider firewall + UFW.

Inspect Coolify logs for the application; Traefik certificate errors appear
in the deployment log lines starting with `acme:` or `certificateResolvers`.

### 502 Bad Gateway

Traefik received the request but the panel container is not reachable.

1. Application is not running. Coolify dashboard → application → check
   container status; **Redeploy** if stopped.
2. **Ports Exposes** doesn't match the container's listening port. The panel's
   `Dockerfile` exposes 80; if you've edited `nginx.conf` to listen elsewhere,
   update **Ports Exposes** accordingly.
3. Health check failing. `/healthz` must return 200; if you've edited
   `nginx.conf` and removed it, re-add it or change the **Health Check Path**.
4. Build crashed and the previous good image was rolled back to nothing.
   Check the deployment log for the latest deploy and fix the build error.

### 504 Gateway Timeout

Traefik forwarded but the container didn't reply in time.

1. Container under load / OOM. Coolify dashboard → server resources; if RAM
   is exhausted, scale the server or trim other applications.
2. The container is alive but stuck on startup (e.g. nginx config error
   keeping it from binding 80). `docker ps` on the host should show the
   container; `docker logs <container>` will surface the binding error.
3. Network policy blocking the Traefik → container hop. Coolify provisions a
   Docker bridge network automatically; if the host's iptables / Docker
   daemon was reconfigured, restart Docker to restore default rules.

### Brand renders the wrong theme

The panel resolves the brand from `window.location.host` at load time. If
`app.examplebrand.com` shows the nixbot theme, the host is hitting a panel
build that doesn't yet contain the `app.examplebrand.com` entry in
`src/lib/brand.ts`. Push the code change and wait for Coolify auto-deploy, or
manually **Redeploy**.

Unknown hosts intentionally fall back to the nixbot brand (see
`resolveBrandFromHost` in `src/lib/brand.ts`) so a bad DNS entry never
breaks the panel — but it also means the symptom of "missing brand entry"
is "looks like nixbot." When in doubt, check `<html data-brand="…">` in
DevTools.
