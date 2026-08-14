# Eventyay Check-In

Check-in, badge printing, and lead scanning for [Eventyay](https://eventyay.com).

Production: [https://access.eventyay.com](https://access.eventyay.com)

Register a device from the organizer **Connected devices** screen, then choose a station:

- **Check-In Staff** — scan tickets, search attendees, live registration, badge print, and offline work after a sync
- **Badge Station** — kiosk check-in and badge print (online only)
- **Lead Scanner** — exhibitor lead capture

Operator guides: [Check-in](docs/checkin.md) · [Exhibitors](docs/exhibitor.md)

## Development

```sh
npm install
npm run dev
```

The app runs at [http://localhost:8085](http://localhost:8085) and proxies `/api` to a local Eventyay backend (`http://127.0.0.1:8000` by default).

```sh
npm run lint
npm run format
npm run test:unit
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks CI runs on pull requests.

## Kiosk (Badge Station)

Chrome with silent printing:

```sh
open -a "Google Chrome" --args --kiosk --kiosk-printing --app=https://access.eventyay.com/?kiosk=true
```

Choose **Badge Station**, register the device, and use the default system printer.

## License

Apache License 2.0. See [LICENSE](LICENSE).
