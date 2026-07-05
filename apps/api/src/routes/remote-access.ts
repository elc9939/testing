import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppBindings } from '../context';

const firewallScriptPath = fileURLToPath(new URL('../../../../scripts/mini-hub-firewall.ps1', import.meta.url));

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

export type RemoteAccessStatus = z.infer<typeof remoteAccessStatusSchema>;
export type RemoteAccessStatusProvider = () => Promise<RemoteAccessStatus>;

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

export function remoteAccessRoutes(statusProvider: RemoteAccessStatusProvider = readLocalRemoteAccessStatus): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/status', async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    try {
      const status = await statusProvider();
      return c.json({ status });
    } catch (error) {
      return c.json({
        status: unavailableStatus(
          error instanceof Error ? error.message : 'Private remote readiness check failed.',
          'Retry Check Services. If this persists, run pnpm bridge:firewall:status on the Windows PC.'
        )
      });
    }
  });

  return app;
}
