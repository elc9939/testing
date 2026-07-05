# Private Remote / Phone LAN Access

The GitHub Pages hub is a static site. When a phone opens it, `127.0.0.1` points at the phone, not the desktop. Also, GitHub Pages is served over HTTPS while these private desktop services use local HTTP, so the most reliable full-control remote mode is to open the hub from the desktop over a private network.

The same HTTPS-to-local-HTTP browser protection can affect desktop-only service pages like AI OS and Macro Lab. If a service page on GitHub Pages says `Failed to fetch`, open the local hub URL printed by the launcher instead of the GitHub Pages URL.

Mini Hub supports three practical modes:

| Mode | URL | Capability |
| --- | --- | --- |
| Local Full Power | `http://127.0.0.1:5173` | Best mode on the Windows PC itself. |
| Private Remote | `http://<desktop-lan-or-tailscale-host>:5173` | Full-power mode from your phone/laptop while the PC is awake and services are running. |
| Hosted Light | `https://elc9939.github.io/testing/` | Static shell. It needs saved private endpoints before heavy local features can work. |

## Quick LAN Setup

1. Start the current bridge launcher:

```powershell
pnpm bridge:start:lan
```

This starts/checks the Mini Hub API, AI OS, Macro Lab, Ollama, and the Svelte hub, then
prints a phone URL. It also copies that URL to the clipboard and saves it to
`bridge-link.txt`.

To have that same phone/private-network bridge start after Windows login:

```powershell
pnpm bridge:startup:install:lan
pnpm bridge:startup:run:lan
```

The older helper still works if you want a visible terminal that stays open:

```text
Start Mini Hub Phone Mode.cmd
```

or:

```powershell
pnpm stack:start:lan
```

If you want to run pieces separately for debugging:

```powershell
pnpm hub:start:lan
pnpm api:start:lan
pnpm ai-os:start:lan
pnpm macro-lab:start:lan
```

2. Open the URL printed by the launcher on the phone. It includes query parameters that store the desktop service URLs automatically. You can also open Settings -> Remote Access / Connection Mode on the PC after Check Services and copy the **Phone / Private Remote Link** shown there.

3. If needed, open Settings -> Remote Access / Connection Mode on the phone and confirm the URLs match the desktop IPv4 shown by the scripts or the detected LAN IPv4 row:

```text
Mini Hub API:  http://<desktop-ip>:8787
AI OS API:     http://<desktop-ip>:8791
Macro Lab API: http://<desktop-ip>:8792
```

4. Save service URLs and use Check Services. Feature Wiring should show whether Hub API, AI OS, Macro Lab, Research, Passive Tasks, Productivity, and browser cache are reachable from that browser.

LAN mode intentionally disables loopback-only protection for AI OS and Macro Lab, so only use it on a trusted private network.

## Tailscale Path

1. Install and sign in to Tailscale on the Windows PC and the remote device.
2. Keep the PC awake.
3. Start Mini Hub in LAN mode with the host your remote device will open:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/mini-hub-bridge.ps1 start -Profile lan -HubUi -RemoteHost <pc-tailscale-name-or-100.x-address>
```

4. Open the printed URL from the remote device.
5. In Settings -> Remote Access / Connection Mode, use current-host URLs if the page was opened through the same Tailscale host, or enter:

```text
Mini Hub API:  http://<pc-tailscale-name-or-100.x-address>:8787
AI OS API:     http://<pc-tailscale-name-or-100.x-address>:8791
Macro Lab API: http://<pc-tailscale-name-or-100.x-address>:8792
```

6. Save Service URLs, then Check Services.

If the browser reports CORS or Private Network Access blocks, rerun the bridge with the
same `-RemoteHost` value the browser uses. If you have an extra private origin that is not
the host in the URL, pass it with `-ExtraTrustedOrigins`, comma-separated.

Do not expose AI OS or Macro Lab publicly. Private Remote is meant for LAN/Tailscale-style access only, because Macro Lab can control Windows and AI OS can touch local models, files, tools, and research routes.
