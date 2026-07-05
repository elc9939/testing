import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';

const firewallScriptPath = fileURLToPath(new URL('../../../../scripts/mini-hub-firewall.ps1', import.meta.url));
const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const tunnelLinkPath = resolve(repoRoot, 'remote-tunnel-link.txt');
const tunnelPidPath = resolve(repoRoot, '.mini-hub-bridge/cloudflared.pid');
const tunnelWatchPidPath = resolve(repoRoot, '.mini-hub-bridge/cloudflared-watch.pid');
const tunnelWatchOutputLogPath = resolve(repoRoot, '.mini-hub-bridge/cloudflared-watch.out.log');
const tunnelWatchErrorLogPath = resolve(repoRoot, '.mini-hub-bridge/cloudflared-watch.err.log');
const phoneTunnelSmokePath = resolve(repoRoot, '.mini-hub-bridge/phone-tunnel-smoke.json');
const tunnelStartupCommandPath =
  process.platform === 'win32' && process.env.APPDATA
    ? resolve(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Startup/Mini Hub Remote Tunnel Watch.cmd')
    : '';

const remoteAccessRuleSchema = z.object({
  service: z.string(),
  port: z.number(),
  installed: z.boolean(),
  enabled: z.boolean(),
  profile: z.string(),
  action: z.string(),
  detail: z.string()
});

const remoteAccessProfileSchema = z.object({
  name: z.string(),
  interfaceAlias: z.string(),
  networkCategory: z.string(),
  ipv4Connectivity: z.string(),
  ipv6Connectivity: z.string()
});

export const remoteAccessStatusSchema = z.object({
  ok: z.boolean(),
  readiness: z.enum(['ready', 'public-network', 'rules-missing', 'unknown']),
  message: z.string(),
  admin: z.boolean(),
  ruleGroup: z.string(),
  gatewayOnly: z.boolean().optional(),
  ports: z.array(z.number()),
  profiles: z.array(remoteAccessProfileSchema),
  rules: z.array(remoteAccessRuleSchema),
  missingRuleCount: z.number(),
  publicNetwork: z.boolean(),
  fixAction: z.string(),
  checkedAt: z.string()
});

export const remoteAccessTunnelSchema = z.object({
  running: z.boolean(),
  pid: z.number().optional(),
  tunnelUrl: z.string().optional(),
  remoteLink: z.string().optional(),
  linkFile: z.string(),
  tokenEmbedded: z.boolean(),
  watcher: z
    .object({
      running: z.boolean(),
      pid: z.number().optional(),
      startupInstalled: z.boolean(),
      startupFile: z.string().optional(),
      outputLog: z.string(),
      errorLog: z.string(),
      checkedAt: z.string()
    })
    .optional(),
  phoneSmoke: z
    .object({
      version: z.number(),
      checkedAt: z.string(),
      ok: z.boolean(),
      origin: z.string().optional(),
      linkFile: z.string().optional(),
      resultFile: z.string(),
      endpoints: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          ok: z.boolean(),
          status: z.number(),
          latencyMs: z.number(),
          detail: z.string()
        })
      ),
      settings: z.object({
        ok: z.boolean(),
        clicked: z.string()
      }),
      routes: z.array(
        z.object({
          id: z.string(),
          path: z.string(),
          ok: z.boolean(),
          heading: z.string(),
          expectedHeading: z.string(),
          tokenSaved: z.boolean(),
          viewport: z
            .object({
              width: z.number(),
              height: z.number()
            })
            .optional(),
          rawNotFound: z.boolean()
        })
      ),
      failures: z.array(z.string())
    })
    .optional(),
  checkedAt: z.string()
});

export type RemoteAccessStatus = z.infer<typeof remoteAccessStatusSchema>;
export type RemoteAccessStatusProvider = () => Promise<RemoteAccessStatus>;
export type RemoteAccessTunnel = z.infer<typeof remoteAccessTunnelSchema>;
export type RemoteAccessTunnelProvider = () => Promise<RemoteAccessTunnel>;

function unavailableStatus(message: string, fixAction: string): RemoteAccessStatus {
  return {
    ok: false,
    readiness: 'unknown',
    message,
    admin: false,
    ruleGroup: 'Mini Hub Private Remote',
    gatewayOnly: true,
    ports: [5173],
    profiles: [],
    rules: [],
    missingRuleCount: 0,
    publicNetwork: false,
    fixAction,
    checkedAt: new Date().toISOString()
  };
}

function execFileText(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function readFirstLine(path: string): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').split(/\r?\n/u)[0]?.trim() ?? '';
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tunnelUrlFromLink(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function tunnelLinkHasToken(value: string): boolean {
  try {
    return Boolean(new URL(value).searchParams.get('bridgeToken'));
  } catch {
    return false;
  }
}

function readPhoneTunnelSmoke(): RemoteAccessTunnel['phoneSmoke'] {
  if (!existsSync(phoneTunnelSmokePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(phoneTunnelSmokePath, 'utf8')) as unknown;
    return remoteAccessTunnelSchema.shape.phoneSmoke.parse(parsed);
  } catch {
    return undefined;
  }
}

export async function readLocalRemoteAccessStatus(): Promise<RemoteAccessStatus> {
  if (process.platform !== 'win32') {
    return unavailableStatus('Private remote firewall checks are only available on Windows.', 'Run the Hub API on the Windows PC that hosts Mini Hub services.');
  }
  if (!existsSync(firewallScriptPath)) {
    return unavailableStatus('Mini Hub firewall helper script was not found.', 'Reinstall or update the repo, then restart the Mini Hub API.');
  }

  const raw = await execFileText('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', firewallScriptPath, 'status', '-Json'], 25_000);
  const parsed = JSON.parse(raw) as unknown;
  return remoteAccessStatusSchema.parse(parsed);
}

export async function readLocalRemoteAccessTunnel(): Promise<RemoteAccessTunnel> {
  const remoteLink = readFirstLine(tunnelLinkPath);
  const pidText = readFirstLine(tunnelPidPath);
  const pid = /^\d+$/u.test(pidText) ? Number(pidText) : undefined;
  const running = pid !== undefined ? processIsRunning(pid) : false;
  const watchPidText = readFirstLine(tunnelWatchPidPath);
  const watchPid = /^\d+$/u.test(watchPidText) ? Number(watchPidText) : undefined;
  const watcherRunning = watchPid !== undefined ? processIsRunning(watchPid) : false;
  const phoneSmoke = readPhoneTunnelSmoke();
  return remoteAccessTunnelSchema.parse({
    running,
    ...(pid !== undefined ? { pid } : {}),
    ...(remoteLink ? { remoteLink, tunnelUrl: tunnelUrlFromLink(remoteLink) } : {}),
    linkFile: tunnelLinkPath,
    tokenEmbedded: tunnelLinkHasToken(remoteLink),
    watcher: {
      running: watcherRunning,
      ...(watchPid !== undefined ? { pid: watchPid } : {}),
      startupInstalled: tunnelStartupCommandPath ? existsSync(tunnelStartupCommandPath) : false,
      ...(tunnelStartupCommandPath ? { startupFile: tunnelStartupCommandPath } : {}),
      outputLog: tunnelWatchOutputLogPath,
      errorLog: tunnelWatchErrorLogPath,
      checkedAt: new Date().toISOString()
    },
    ...(phoneSmoke ? { phoneSmoke } : {}),
    checkedAt: new Date().toISOString()
  });
}

export function remoteAccessRoutes(
  statusProvider: RemoteAccessStatusProvider = readLocalRemoteAccessStatus,
  tunnelProvider: RemoteAccessTunnelProvider = readLocalRemoteAccessTunnel
): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/status', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const tunnel = await tunnelProvider().catch(() =>
      remoteAccessTunnelSchema.parse({
        running: false,
        linkFile: tunnelLinkPath,
        tokenEmbedded: false,
        checkedAt: new Date().toISOString()
      })
    );
    try {
      const status = await statusProvider();
      return c.json({ status, tunnel });
    } catch (error) {
      return c.json({
        status: unavailableStatus(
          error instanceof Error ? error.message : 'Private remote readiness check failed.',
          'Retry Check Services. If this persists, run pnpm bridge:firewall:status on the Windows PC.'
        ),
        tunnel
      });
    }
  });

  return app;
}
