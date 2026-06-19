# Phone LAN Access

The GitHub Pages hub is a static site. When a phone opens it, `127.0.0.1` points at the phone, not the desktop. To let the phone use the desktop API, AI OS, and Macro Lab while the computer is running:

1. Start the services on the desktop in LAN mode:

```powershell
pnpm api:start:lan
pnpm ai-os:start:lan
pnpm macro-lab:start:lan
```

2. Open Settings -> Desktop Services on the phone.

3. Set the service URLs to the desktop IPv4 shown by the scripts:

```text
Mini Hub API:  http://<desktop-ip>:8787
AI OS API:     http://<desktop-ip>:8791
Macro Lab API: http://<desktop-ip>:8792
```

4. Save service URLs and use Check API.

LAN mode intentionally disables loopback-only protection for AI OS and Macro Lab, so only use it on a trusted private network.
