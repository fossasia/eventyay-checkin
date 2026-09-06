# Eventyay Check-In

Check-in, badge printing, and attendee lead scanning client for [Eventyay](https://eventyay.com).

- **Production App**: [https://access.eventyay.com](https://access.eventyay.com)
- **Operator Guides**: [Check-in Staff & Kiosks](docs/checkin.md) · [Exhibitor Lead Retrieval](docs/exhibitor.md)

---

## Features

Register a device from the organizer **Connected devices** screen, then choose a station:

- **Check-In Staff**: Scan tickets (QR/barcode), search attendees, process live registrations, print attendee badges, and continue working offline after initial sync.
- **Badge Station**: Self-service kiosk mode for attendee check-in and on-demand badge printing (online mode).
- **Lead Scanner**: Exhibitor lead capture and management station.

---

## Prerequisites

Ensure you have the following installed on your local environment:

- **Node.js**: `v18.x` or `v20.x` (LTS recommended)
- **npm**: `v9.x` or higher (or compatible package manager like Yarn / pnpm)
- **Eventyay Backend** (optional for local full-stack dev): Running locally at `http://127.0.0.1:8000` (or configured proxy target)

---

## Installation & Local Development

1. **Clone the repository**:
   ```sh
   git clone https://github.com/fossasia/eventyay-checkin.git
   cd eventyay-checkin
   ```

2. **Install dependencies**:
   ```sh
   npm install
   # or for a clean CI-style install:
   npm ci
   ```

3. **Start the local development server**:
   ```sh
   npm run dev
   ```
   The application will be accessible at [http://localhost:8085](http://localhost:8085). By default, API requests to `/api` proxy to `http://127.0.0.1:8000`.

---

## Testing & Quality Checks

Run the following scripts before creating a pull request:

```sh
# Linting
npm run lint          # Check code with ESLint
npm run lint:fix      # Automatically fix ESLint issues

# Formatting
npm run format:check  # Check formatting for unit-test files with Prettier
npm run format        # Auto-format files

# Unit Tests
npm run test:unit     # Run unit tests with Vitest

# Production Build Check
npm run build         # Build the production bundle
```

For more details on CI checks and testing guidelines, refer to [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Kiosk Mode (Badge Station)

To launch a dedicated kiosk terminal with silent badge printing using Google Chrome:

```sh
open -a "Google Chrome" --args --kiosk --kiosk-printing --app=https://access.eventyay.com/?kiosk=true
```

1. Select **Badge Station**.
2. Register the device.
3. Configure the default system printer for label/badge printing.

---

## Contributing

We welcome contributions from the community! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) for development workflows, coding conventions, and pull request guidelines.

---

## Community & Support

- **Issues & Bug Reports**: [GitHub Issues](https://github.com/fossasia/eventyay-checkin/issues)
- **Main Project Repository**: [Eventyay](https://github.com/fossasia/eventyay)
- **Website**: [eventyay.com](https://eventyay.com)

---

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

