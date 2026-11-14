# @taalcut/billing-worker

The Cloudflare Worker behind Taalcut Premium's order form. It decides the price, takes the order, has the payment
provider (Razorpay) make a payment link for it, and confirms the payment by reading the link back from the
provider. It serves `https://billing.taalcut.app`; the website's `/premium/` pages are its only caller.

## What it will not do

- **Charge an amount a browser sent.** The price comes from the catalogue in `wrangler.jsonc` and the clock
  (`src/pricing/quote.ts`). The form may say which amount the page showed (`expect`); when that is no longer the
  price, the order is refused with the new quote so the buyer sees it first. A plan can have a price in more than
  one currency (US dollars and Indian rupees today). A browser may say which of them it wants, never how much.
- **Believe that an order is paid because someone said so.** The buyer's return, the provider's webhook delivery
  and the scheduled sweep are each only a reason to look. `src/orders/settle.ts` reads the link from the provider
  and makes the order paid only when that record names this order, carries its amount and currency, and is paid in
  full. Signatures (`src/razorpay/signature.ts`) are checked first so unsigned values never cause a lookup.
- **Tell anyone twice.** One conditional statement makes an order paid; only the request that made it so tells us
  and the buyer. The sweep retries a telling that failed.
- **Keep what it does not need.** Card details never reach it. The payment provider gets the buyer's name, email
  and phone number, which it requires to make a payment page, and nothing else from the form. An order never paid is deleted after four weeks. Logs carry order ids, never a name, an address or a key.
- **Let one caller use up everyone's orders.** A JSON route takes `application/json` only and refuses a page that
  is not the website's, so another site cannot order from its visitors' browsers. Each caller (an IPv4 address or
  an IPv6 /64) has a burst and a day's allowance, counted under a keyed hash that is deleted the next day; a shared day's
  allowance sits behind those. An order refused for its fields, its plan or its price spends none of them. What
  this does not stop is someone with many networks; the form has no human check yet.
- **Email a stranger.** The provider is told to message nobody about a link. In the provider's test mode, where a
  payment costs nothing, the buyer's message goes to us instead.

## Routes

| Route                       | What                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `GET /v1/health`            | `{ ok, selling }`                                                                       |
| `GET /v1/quote?plan=&ref=`  | The price now, the list price, the offer that applies and whether orders are taken      |
| …`&currency=`               | `auto`: the visitor's own currency, by the country the request comes from. Or a code    |
| `POST /v1/checkout`         | The order form. Answers with the payment page's address                                 |
| `POST /v1/orders/confirm`   | The buyer's signed return. Answers with the order's outcome and dates, no personal data |
| `POST /v1/razorpay/webhook` | The provider's signed deliveries                                                        |
| scheduled, every 5 minutes  | The sweep: settles open orders, retries tellings, deletes what is due                   |

A refusal is `{ "code": "billing.<name>" }`: `invalid` (400, 413 or 415, with `problems`), `unauthorized` (401),
`forbidden` (403, a page that is not the website's), `not_found` (404), `price_changed` (409, with `quote`), `rate_limited` (429), `busy` (500), `provider_unavailable`
(502), `not_selling` (503). Only `https://taalcut.app` may read the answers (CORS).

## Configuration

Variables, in `wrangler.jsonc`:

| Variable                   | What                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `CATALOG`                  | Plans with their prices, and offers with their amounts, spans and optional `ref` code |
| `MODE`                     | `live` or `test`. The key pair must be of this mode or nothing is sold                |
| `SELLING`                  | `off` stops new orders; payments already started are still confirmed                  |
| `SITE_ORIGIN`              | Where the buyer returns to (`/premium/thanks/`)                                       |
| `ALLOWED_ORIGINS`          | The origins whose pages may read the answers, comma-separated                         |
| `OWNER_EMAIL`, `MAIL_FROM` | Who is told about a paid order, and the sender of both emails                         |

Secrets, set with `wrangler secret put <NAME>` and never written to a file:

| Secret                    | What                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAZORPAY_KEY_ID`         | The API key's id                                                                                                                            |
| `RAZORPAY_KEY_SECRET`     | The API key's secret. It can charge: treat it accordingly                                                                                   |
| `RAZORPAY_WEBHOOK_SECRET` | Optional. Signs webhook deliveries; a different value from the key. Without it the sweep alone settles orders the buyer did not return from |
| `NOTIFY_WEBHOOK_URL`      | Optional. A chat webhook that is also told about a paid order                                                                               |

Without the key pair the Worker still deploys and quotes prices, with `selling: false`. The secrets are not under
`secrets.required` for that reason.

The webhook, when used: `https://billing.taalcut.app/v1/razorpay/webhook`, events `payment_link.paid`,
`payment_link.expired` and `payment_link.cancelled`.

## Deploying

```sh
pnpm --filter @taalcut/billing-worker exec wrangler d1 migrations apply taalcut-billing --remote
pnpm --filter @taalcut/billing-worker exec wrangler deploy --env=""          # production, billing.taalcut.app
pnpm --filter @taalcut/billing-worker exec wrangler deploy --env staging     # the provider's test mode
```

The `staging` environment is the same Worker with `MODE` `test`, its own database and a `workers.dev` address. It
is where an end-to-end payment is tried with test keys and no money.

## Tests

Offline. The node project runs every route against a real SQLite database (Node's `node:sqlite`, which is what D1
is) loaded from `migrations/`, a fake payment provider that a test can pay, expire, cancel and tamper with, a fake
mailbox and a fake chat webhook; the REST client is checked against recorded provider answers. The Workers project
boots the Worker in Miniflare with the deployed `wrangler.jsonc`, D1 and placeholder keys, and sends both emails
through the simulated email binding. `wrangler.jsonc` keeps `compatibility_date` `2026-10-13` for the reason
[the hub Worker's README](../hub-worker/README.md) gives.
