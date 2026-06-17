export const surface = {
  page: 'min-height:100vh;background:var(--bg);color:var(--text);',
  panel: 'border:1px solid var(--border);background:var(--surface);border-radius:8px;',
  button: 'border:1px solid var(--border-strong);border-radius:6px;background:var(--surface);color:var(--text);'
} as const;

export const palette = {
  ink: 'var(--text)',
  paper: 'var(--bg)',
  panel: 'var(--surface)',
  border: 'var(--border)',
  blue: 'var(--accent)',
  violet: 'var(--accent)',
  amber: '#f2c14e',
  coral: '#ff9f6e',
  green: '#4fb477'
} as const;

export function statusLabel(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
