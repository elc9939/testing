export type CompactServiceIssueKind =
  | 'none'
  | 'telemetry'
  | 'timeout'
  | 'wrong-endpoint'
  | 'browser-blocked'
  | 'offline'
  | 'auth'
  | 'invalid-response'
  | 'unknown';

export interface CompactServiceIssue {
  kind: CompactServiceIssueKind;
  summary: string;
  raw: string;
}

const serviceIssuePattern =
  /(?:AI OS|Mini Hub API|Macro Lab|api|service|route|Failed to fetch|fetch failed|CORS|mixed-content|timed out|timeout|abort|aborted|unavailable|offline|Not Found|ECONNREFUSED|connection refused|returned.*HTML|static site|github pages|token|expired|revoked|401|403|unauthori[sz]ed|forbidden|permission|invalid_type|expected .* received|validation|schema|GPU telemetry|nvidia-smi|Win32_|Win32|VideoController|PowerShell|HardwareInformation|GPUAdapterMemory|api\.openai\.com|Client error)/iu;

export function isLikelyServiceIssue(value: string): boolean {
  return serviceIssuePattern.test(value.trim());
}

export function classifyServiceIssue(message = ''): CompactServiceIssue {
  const text = message.trim();
  if (!text) return { kind: 'none', summary: 'unavailable', raw: '' };
  if (/gpu telemetry|nvidia-smi|win32_perf|win32_videocontroller|win32_gpu|videocontroller|powershell|winerror|hardwareinformation|gpuadaptermemory/iu.test(text)) {
    return { kind: 'telemetry', summary: 'telemetry unavailable', raw: text };
  }
  if (/timed out|timeout/iu.test(text)) return { kind: 'timeout', summary: 'timed out', raw: text };
  if (/AbortError|operation was aborted|request aborted|aborted/iu.test(text)) return { kind: 'timeout', summary: 'request aborted or timed out', raw: text };
  if (/github pages|returned.*html|static website|static site|wrong endpoint|missing route|route .*not found|404|not found/iu.test(text)) {
    return { kind: 'wrong-endpoint', summary: 'wrong endpoint or missing route', raw: text };
  }
  if (/auth|token|expired|revoked|unauthori[sz]ed|permission|forbidden|401|403/iu.test(text)) {
    return { kind: 'auth', summary: 'auth or permission needed', raw: text };
  }
  if (/invalid_type|expected .* received|validation|schema|zod/iu.test(text)) {
    return { kind: 'invalid-response', summary: 'unexpected response shape', raw: text };
  }
  const genericNetworkHint = /This can also be a CORS, firewall, service-offline, or mixed-content block/iu.test(text);
  const explicitBrowserBlock =
    !genericNetworkHint &&
    /hosted HTTPS page may be blocked|blocked from reaching|blocked from calling|insecure LAN HTTP endpoint|browser blocked|blocked by CORS|CORS policy|preflight|mixed-content|mixed content|https page/iu.test(
      text
    );
  if (/failed to fetch|fetch failed|econnrefused|connection refused|network|offline|unavailable|service-offline/iu.test(text)) {
    return explicitBrowserBlock
      ? { kind: 'browser-blocked', summary: 'browser blocked request', raw: text }
      : { kind: 'offline', summary: 'service offline or unreachable', raw: text };
  }
  if (explicitBrowserBlock || /cors|firewall|blocked/iu.test(text)) {
    return { kind: 'browser-blocked', summary: 'browser blocked request', raw: text };
  }
  return { kind: 'unknown', summary: truncateServiceIssue(text), raw: text };
}

export function compactServiceIssueLine(message = '', serviceLabel = 'Service'): string {
  const issue = classifyServiceIssue(message);
  if (issue.kind === 'telemetry') {
    return `${serviceLabel} is unavailable. Check AI OS machine profile and Windows/AMD telemetry setup.`;
  }
  if (issue.kind === 'timeout') {
    return `${serviceLabel} timed out. Cached data stays visible when available; retry after the service settles.`;
  }
  if (issue.kind === 'wrong-endpoint') {
    return `${serviceLabel} is pointed at the wrong endpoint or a missing route. Open Settings Feature Wiring and check the saved service URL.`;
  }
  if (issue.kind === 'browser-blocked') {
    return `The browser blocked ${serviceLabel}. Open the local hub URL, or check CORS, mixed-content, and firewall settings.`;
  }
  if (issue.kind === 'offline') {
    return `${serviceLabel} is offline or unreachable. Start the desktop service, then retry.`;
  }
  if (issue.kind === 'auth') {
    return `${serviceLabel} needs authentication or permission before this action can run.`;
  }
  if (issue.kind === 'invalid-response') {
    return `${serviceLabel} returned data in an unexpected shape. Restart or update the desktop service, then retry.`;
  }
  if (issue.kind === 'none') {
    return `${serviceLabel} is unavailable. Refresh or open Settings Feature Wiring.`;
  }
  return `${serviceLabel}: ${issue.summary}`;
}

export function compactServiceIssueIfRecognized(message = '', serviceLabel = 'Service'): string {
  const text = message.trim();
  if (!text) return '';
  const issue = classifyServiceIssue(text);
  if (issue.kind === 'unknown') return text;
  return compactServiceIssueLine(text, serviceLabel);
}

function truncateServiceIssue(value: string): string {
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}
