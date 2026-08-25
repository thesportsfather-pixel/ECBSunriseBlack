# ECB Sunrise — Road to Cooperstown Fundraiser

This repo is designed for **Cloudflare Pages + Pages Functions + Supabase + Stripe Checkout**.

## Roster

- #1 Anthony C
- #2 Jack J
- #7 Ezra F
- #11 Zachary Z
- #12 Harrison Z
- #15 Nicolas H
- #16 Andrew P
- #20 Dylan N
- #27 Julian S
- #28 Eli O
- #44 Jase H

Each player has baseballs **1–100**, so the full player goal is **$5,050**.

## GitHub file tree

```text
/
├─ index.html
├─ fundraiser.html
├─ README.md
├─ assets/
│  └─ ecb-sunrise-logo.png
├─ functions/
│  └─ api/
│     ├─ _shared.js
│     ├─ fundraiser.js
│     ├─ create-checkout.js
│     ├─ verify-payment.js
│     └─ webhook.js
└─ supabase/
   └─ schema.sql
```

## Step 1 — Supabase

Open your Supabase project → SQL Editor → New query.

Paste and run:

`supabase/schema.sql`

That creates:
- `teams`
- `players`
- `baseballs`
- `orders`

It also inserts ECB Sunrise, all 11 players, and 100 baseballs per player.

## Step 2 — GitHub

Create a new GitHub repo, for example:

`ecb-sunrise-cooperstown`

Upload the entire contents of this folder to the root of the repo.

## Step 3 — Cloudflare Pages

Create a new Pages project connected to the GitHub repo.

Recommended:
- Framework preset: None
- Build command: leave blank
- Build output directory: `/`
- Production branch: `main`

Cloudflare Pages will automatically recognize the `/functions` directory.

## Step 4 — Cloudflare environment variables

Cloudflare Dashboard → Workers & Pages → your project → Settings → Variables and Secrets.

Add these as **Production secrets**:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Use the same live Stripe account strategy as the TBT fundraiser.

Redeploy after adding secrets.

## Step 5 — Stripe webhook

In Stripe, create a webhook endpoint pointing to:

`https://YOUR-PAGES-DOMAIN.pages.dev/api/webhook`

Listen for:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Copy the endpoint signing secret beginning with `whsec_...` into Cloudflare as:

`STRIPE_WEBHOOK_SECRET`

## Step 6 — Test URLs

Main page:

`https://YOUR-PAGES-DOMAIN.pages.dev/fundraiser.html`

Direct player page example:

`https://YOUR-PAGES-DOMAIN.pages.dev/fundraiser.html?player=dylan-n`

API test:

`https://YOUR-PAGES-DOMAIN.pages.dev/api/fundraiser?team=ecb-sunrise&player=dylan-n`

The API test should return `"success": true` and 100 baseball records.

## Player direct-link slugs

- Anthony C #1 → `anthony-c`
- Jack J #2 → `jack-j`
- Ezra F #7 → `ezra-f`
- Zachary Z #11 → `zachary-z`
- Harrison Z #12 → `harrison-z`
- Nicolas H #15 → `nicolas-h`
- Andrew P #16 → `andrew-p`
- Dylan N #20 → `dylan-n`
- Julian S #27 → `julian-s`
- Eli O #28 → `eli-o`
- Jase H #44 → `jase-h`

## Important

Do **not** put Stripe or Supabase secret keys inside `fundraiser.html`.
They belong only in Cloudflare environment variables.
