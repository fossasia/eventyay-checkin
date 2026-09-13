# Checkin workflow

**Step 1:** Choose a station type on the login page (`Check-In Staff`, `Badge Station`, or `Lead Scanner`).

**Step 2:** Register the device by scanning the organizer QR code from **Connected devices**, or choose **Or enter URL and Token manually** and enter your server URL and setup token.

<img src="./images/deviceauth2.png" alt="Device registration with QR code">

**Step 3:** Select the event and, for check-in staff or badge stations, the check-in list.

<img src="./images/eventselect2.png" alt="Event selection">

**Step 4:** Scan attendee tickets with the camera.

<img src="./images/checkin.png" alt="Checkin camera">

**Step 5:** After a successful checkin, a popup shows attendee name and ticket details. Organizers can configure extra fields per check-in list in the Eventyay control panel.

Use **Print badge** or **Print preview** when badges are enabled.

<img src="./images/info.png" alt="Attendee info popup">

**Step 6:** If badge customization is enabled for the layout, choose which fields to include before printing.

<img src="./images/selectopt.png" alt="Badge print options">

**Step 7:** Confirm the browser print dialog when printing manually.

<img src="./images/preview.png" alt="Badge preview">

## Offline mode (Check-In Staff only)

Badge Station stays **online-only**. Check-In Staff can continue after a first successful sync.

1. While online, open check-in (or click **Sync** in the header) so layouts and attendee field data download into an encrypted on-device snapshot.
2. If the network drops, known tickets still check in / out. Actions queue and upload when you reconnect.
3. If a ticket is **not** in the snapshot yet, the app asks you to connect and sync latest check-in data — it will not invent tickets offline.
4. Live registration while offline is queued; the real ticket secret exists only after sync succeeds. Print after sync.
5. Badges print from synced **layout JSON** + per-attendee **field data** (`pdf_data`), not from cached full PDF files.
6. Sign out wipes the encrypted snapshot from the device.

## Kiosk Mode & Badge Station Setup

Badge Stations automatically trigger badge printing upon ticket scan when running in Kiosk Mode (`?kiosk=true`).

### Desktop Kiosk Setup (Chrome / Firefox)
- **Chrome**: Launch with `--kiosk --kiosk-printing "https://access.eventyay.com/?kiosk=true"`.
- **Firefox**: Launch with `-kiosk -pref "print.always_print_silent,true" "https://access.eventyay.com/?kiosk=true"`.

### Tablet & Mobile Kiosk Setup (Android & iPadOS)
1. Open the check-in web application in your tablet browser.
2. Tap **Add to Home screen** / **Install app** to launch the web app in standalone fullscreen kiosk mode.
3. Configure your default badge printer in device system settings (**Settings > Connected devices > Printing**).
4. Append `?kiosk=true` to your Badge Station URL. Badges queue and print via the web app's silent iframe print stream post-scan.

