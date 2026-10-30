# Yeelock Controller

An offline-first, browser-based controller for the Yeelock M02-compatible Bluetooth cabinet lock. Run `npm install`, then `npm run dev`. Run `npm test` and `npm run build` to verify the project. Serve the production `dist` directory over HTTPS; Web Bluetooth requires a secure context and a supported browser (Chrome on Android). Install from Chrome's menu after loading the app online once. Chrome on iPhone and iPad does not provide Web Bluetooth, so it cannot connect to the lock; use Chrome on Android. The app shell is cached for offline use.

## Adding a lock

You need the lock's serial number and Bluetooth signing key, legitimately obtained from your existing Yeelock setup. The PWA does not log into Yeelock or extract keys. For an email-based Yeelock account, run `python3 scripts/fetch-yeelock-keys.py` on your computer to try retrieving them. The script uses an unofficial API and may sign you out of the official app; its login request includes credentials in the HTTPS URL, which may be logged by Yeelock or network intermediaries. The script does not save the keys. The Bluetooth chooser filters for the known Yeelock service or an `EL_` name; devices are checked for the required characteristics after selection. Choose your device, enter the details, then press **Verify & unlock**. This physically sends an unlock command; registration succeeds only if the lock reports unlock completion. If permission to reconnect is lost, use Reconnect in the lock details and select the same device.

Credentials are stored unencrypted in browser IndexedDB. Anyone with access to this browser profile or JavaScript running on this origin may be able to read them. Removing a lock deletes its credential and local operation history. Browser storage eviction or clearing site data also removes them.

## Protocol and limits

The packet format and notification codes follow [Yeehack](https://github.com/aso824/yeehack), specifically its implementation in `packet.py` and `connection.py`, and the service UUID documented in [this protocol investigation](https://github.com/cnrd/yeelock/issues/3). Yeehack is licensed under Apache 2.0. The Home Assistant integration identifies the M02 as a compatible model. The references disagree on signature length in the prose; this implementation follows Yeehack's executable code (13 bytes for action packets).

A successful Bluetooth write is not considered success: the app waits for the corresponding completion notification. A timeout or disconnect after sending yields an unknown result; check the cabinet before trying again. No unlock command is automatically replayed. If the lock requests time synchronization, the app sends a signed clock update and asks you to check the cabinet before a new attempt; it does not automatically replay the command. Notifications and behavior have not been verified on physical hardware; test on the intended lock before relying on the app. Locking is offered based on the reference implementation but also requires hardware validation.

The app disconnects after each operation. The browser may require the user to select a previously authorized device again. Diagnostics report only services the browser has permission to access, and are exported only on request.

## GitHub Pages

The Pages workflow builds with the `/yeelock-pwa/` base path and deploys on pushes to `main`. In the repository's **Settings → Pages**, set the build and deployment source to **GitHub Actions**. Once deployed, open `https://johnou.github.io/yeelock-pwa/` in Chrome on Android. The first load requires internet; later visits can use the cached app shell.

You can rename a registered lock or enable **Auto-lock** in its details. Auto-lock is on by default for newly added locks; settings on existing locks are preserved. When enabled, the app starts a lock operation six seconds after a confirmed unlock; the lock must support the referenced electronic lock command. Keep the app open in the foreground and within Bluetooth range. If the app is hidden before the timer fires or the timer fires more than two seconds late, auto-lock is cancelled and the cabinet must be locked manually. A timeout or failed auto-lock is not retried, and an unknown unlock result never schedules an auto-lock. Hardware behavior still needs validation.
