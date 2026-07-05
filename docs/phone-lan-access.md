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

2. Open the URL printed by the launcher on the phone. It includes query parameters that store the desktop gateway URL automatically for Hub API, AI OS, Macro Lab, and Ollama. You can also open Settings -> Remote Access / Connection Mode on the PC after Check Services and scan or copy the **Phone / Private Remote Link** shown there.

3. If needed, open Settings -> Remote Access / Connection Mode on the phone and confirm the URLs match the desktop IPv4 shown by the scripts or the detected LAN IPv4 row. In the default gateway mode, every service URL should use the Hub gateway:

```text
Mini Hub API:  http://<desktop-ip>:5173
AI OS API:     http://<desktop-ip>:5173
Macro Lab API: http://<desktop-ip>:5173
Ollama:        http://<desktop-ip>:5173
```

4. Save service URLs and use Check Services. Feature Wiring should show whether Hub API, AI OS, Macro Lab, Research, Passive Tasks, Productivity, and browser cache are reachable from that browser. The Phone readiness row should also explain whether the private remote path is ready, blocked by a Public Windows network profile, missing firewall rules, or unable to reach the Hub API.

LAN mode now exposes the Hub gateway on the trusted network while AI OS, Macro Lab, and
Ollama remain localhost services behind that gateway. Still use it only on a trusted
private network because the Hub gateway can invoke those local services.

If the phone cannot open the link even though the PC can, run:

```powershell
pnpm bridge:firewall:status
```

The same diagnosis is visible in Settings -> Remote Access / Connection Mode after Check
Services through the Hub API `/api/remote-access/status` endpoint.

This checks whether Windows sees the active network as Private and whether the Mini Hub
gateway inbound rule exists for port `5173`. If the rule is missing, run:

```powershell
pnpm bridge:firewall:install
```

If the current terminal is not elevated, Windows will ask for administrator approval and
continue the helper in an elevated PowerShell prompt.
The installed rules are scoped to the Windows Private firewall profile. If the Wi-Fi is
marked Public, mark only your trusted home/private network as Private before testing from
the phone.

For the common combined case, run:

```powershell
pnpm bridge:repair:lan
```

That opens one Windows administrator prompt, marks the active trusted network Private, and
installs the Mini Hub Private gateway firewall rule for port `5173`.

## No-Inbound Temporary Tunnel

If Windows inbound firewall/profile setup is annoying or you want to test from outside the
home Wi-Fi, use the outbound tunnel launcher:

```powershell
pnpm bridge:tunnel:start
```

This keeps the same single-port Hub gateway on the PC, starts it with a generated bridge
token, downloads `cloudflared.exe` into `.mini-hub-bridge/tools` if needed, and opens a
temporary Cloudflare Quick Tunnel to `http://127.0.0.1:5173`. The launcher writes the full
phone URL to `remote-tunnel-link.txt` and tries to copy it to the clipboard.
If Cloudflare has dropped an older quick-tunnel URL while the old process is still around,
running `pnpm bridge:tunnel:start` again replaces it and writes a fresh phone link.
Use `pnpm bridge:tunnel:status` for a redacted status view, or
`pnpm bridge:tunnel:verify` to check that Mini Hub API, AI OS, Macro Lab, and Ollama are
reachable through the public tunnel without printing the private bridge token.

For a less manual phone setup, keep the tunnel watcher running:

```powershell
pnpm bridge:tunnel:watch:start
pnpm bridge:tunnel:watch:status
```

The watcher runs hidden, checks the saved HTTPS tunnel while the PC is awake, and repairs
the Cloudflare Quick Tunnel when the old URL goes stale. To have that watcher come back
after Windows login, install the current-user startup entry once:

```powershell
pnpm bridge:tunnel:startup:install
pnpm bridge:tunnel:startup:status
```

The full private phone URL remains in `remote-tunnel-link.txt`; status output redacts the
bridge token. Stop the watcher with `pnpm bridge:tunnel:watch:stop`, and remove the
startup entry with `pnpm bridge:tunnel:startup:remove`.

To test the saved tunnel with a phone-sized browser from the PC:

```powershell
pnpm qa:hub:phone:tunnel
```

That smoke check reads `remote-tunnel-link.txt`, verifies Mini Hub API, AI OS, Macro Lab,
and Ollama through the HTTPS tunnel, then launches headless Chromium in a mobile viewport
and route-hops through Settings, Today, Activity, Research, and AI OS. It prints the tunnel
origin and pass/fail evidence, but never prints the bridge token.

Settings -> Remote Access / Connection Mode also reads the active tunnel state from the
Mini Hub API. When the tunnel is running, the Phone / Private Remote Link panel prefers
the HTTPS tunnel link, shows a QR code for phone testing, and marks the current
`trycloudflare.com` origin as an HTTPS Tunnel even after you navigate away from the long
query-string URL. The same panel also shows **Tunnel watcher and startup readiness**, so
you can tell whether stale Cloudflare URLs will be repaired in the background and whether
the watcher will relaunch after Windows login.

The URL includes `bridgeToken=...`; the hub stores that in the browser and sends it as
`X-Mini-Hub-Bridge-Token` before the gateway proxies Hub API, AI OS, Macro Lab, or Ollama
requests. Treat the URL like a temporary private key. Stop the tunnel when you are done:

```powershell
pnpm bridge:tunnel:stop
```

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
Mini Hub API:  http://<pc-tailscale-name-or-100.x-address>:5173
AI OS API:     http://<pc-tailscale-name-or-100.x-address>:5173
Macro Lab API: http://<pc-tailscale-name-or-100.x-address>:5173
Ollama:        http://<pc-tailscale-name-or-100.x-address>:5173
```

6. Save Service URLs, then Check Services.

If the browser reports CORS or Private Network Access blocks, rerun the bridge with the
same `-RemoteHost` value the browser uses. If you have an extra private origin that is not
the host in the URL, pass it with `-ExtraTrustedOrigins`, comma-separated.

Do not expose AI OS or Macro Lab publicly. Private Remote is meant for LAN/Tailscale-style access only, because Macro Lab can control Windows and AI OS can touch local models, files, tools, and research routes.
