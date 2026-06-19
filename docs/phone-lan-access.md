# Phone LAN Access

The GitHub Pages hub is a static site. When a phone opens it, `127.0.0.1` points at the phone, not the desktop. Also, GitHub Pages is served over HTTPS while these private desktop services use local HTTP, so the most reliable full-control mode is to open the hub from the desktop over LAN.

1. Double-click this file in the repo folder:

```text
Start Mini Hub Phone Mode.cmd
```

This starts the Mini Hub API, AI OS, Macro Lab, and the Svelte hub, then prints a phone URL. It also copies that URL to the clipboard and saves it to `phone-link.txt`.

If you prefer the terminal, this is the same thing:

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

2. Open the URL printed by the launcher on the phone. It includes query parameters that store the desktop service URLs automatically.

3. If needed, open Settings -> Desktop Services on the phone and confirm the URLs match the desktop IPv4 shown by the scripts:

```text
Mini Hub API:  http://<desktop-ip>:8787
AI OS API:     http://<desktop-ip>:8791
Macro Lab API: http://<desktop-ip>:8792
```

4. Save service URLs and use Check API.

LAN mode intentionally disables loopback-only protection for AI OS and Macro Lab, so only use it on a trusted private network.
