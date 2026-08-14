# Eventyay Check-In

Vue 3 check-in app for [Eventyay](https://eventyay.com): device pairing, ticket scanning, badge printing, lead scanning, and offline sync for Check-In Staff.

[![Netlify Status](https://api.netlify.com/api/v1/badges/7456234f-3254-4395-8cd8-67979322e555/deploy-status)](https://app.netlify.com/sites/open-event-checkin/deploys)

## Station types

| Role | Device security profile | Notes |
|---|---|---|
| **Check-In Staff** | `eventyay_checkin` | Scan, search, live registration, badge print, **offline sync** |
| **Badge Station** | `eventyay_checkin_online_kiosk` | Kiosk check-in + badge print — **online only** |
| **Lead Scanner** | `full` (typical) | Exhibitor lead capture |

See operator guides: [`docs/checkin.md`](docs/checkin.md), [`docs/exhibitor.md`](docs/exhibitor.md).

## Offline sync (Check-In Staff)

Implements [issue #103](https://github.com/fossasia/eventyay-checkin/issues/103).

- Syncs **badge layouts** and lean per-attendee **`pdf_data`** (not full badge PDFs)
- Stores an **encrypted JSON snapshot** on the device (Web Crypto AES-GCM) — no client SQL/Prisma DB
- Offline scan uses the snapshot; unknown tickets ask you to reconnect and sync
- Queued check-ins and live registrations flush when online again
- Badges can render locally from layout JSON + field data

Requires Eventyay backend device ACL for order / revoked-secret sync (Check-In Staff profile).

## Development

```sh
npm install
npm run dev
```

App: [http://localhost:8085](http://localhost:8085) (Vite; proxies `/api` to the Eventyay backend).

```sh
npm run lint
npm run format
npm run test:unit
npm run build
```

## Production

The check-in app is hosted at [https://access.eventyay.com](https://access.eventyay.com). Pair devices from the organizer **Connected devices** screen in Eventyay.

## Kiosk mode (Badge Station)

Silent printing example (Chrome):

```sh
open -a "Google Chrome" --args --kiosk --kiosk-printing --app=https://access.eventyay.com/?kiosk=true
```

1. Choose **Badge Station**
2. Register the device
3. Use the default system printer

## Stack

- Vue 3, Vue Router, Pinia
- Tailwind CSS, Headless UI, Heroicons
- Vitest, Cypress (e2e), Vite 6

## License

Apache License 2.0 — see [LICENSE](LICENSE). Contact [FOSSASIA](https://blog.fossasia.org/contact/) for other licensing.
