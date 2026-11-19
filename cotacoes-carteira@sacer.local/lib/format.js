// Formatação em português do Brasil, sem depender de Intl.
export function fmt(n, decimals = 2) {
  if (n == null || Number.isNaN(n)) return '--';
  const neg = n < 0 && Number(Math.abs(n).toFixed(decimals)) !== 0;
  const [int, frac] = Math.abs(n).toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

export const brl = (n, d = 2) => `R$ ${fmt(n, d)}`;
export const usd = (n, d = 2) => `US$ ${fmt(n, d)}`;

export function signed(n, decimals = 2) {
  if (n == null || Number.isNaN(n)) return '--';
  return `${n > 0 ? '+' : ''}${fmt(n, decimals)}`;
}

export const arrow = n => (n > 0 ? '▲' : n < 0 ? '▼' : '■');
export const tone = n => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

export function timeAgo(iso) {
  if (!iso) return '';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return 'agora há pouco';
  if (secs < 3600) return `há ${Math.round(secs / 60)} min`;
  if (secs < 86400) return `há ${Math.round(secs / 3600)} h`;
  return `há ${Math.round(secs / 86400)} dias`;
}
