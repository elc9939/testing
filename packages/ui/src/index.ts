export const surface = {
  page: 'min-height:100vh;background:#f6f8fb;color:#18202f;',
  panel: 'border:1px solid #dfe5ee;background:#fff;border-radius:8px;',
  button: 'border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#18202f;'
} as const;

export const palette = {
  ink: '#18202f',
  paper: '#f6f8fb',
  panel: '#ffffff',
  border: '#dfe5ee',
  green: '#4fb477',
  blue: '#5aa9e6',
  amber: '#f2c14e',
  coral: '#ff9f6e',
  violet: '#b87cff'
} as const;

export function statusLabel(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

