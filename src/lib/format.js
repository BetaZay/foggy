export function formatDate(value) {
  if (!value || value === '0000-00-00 00:00:00') return '—';
  const normalized = /^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unit)).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

export function taskTone(task) {
  if (task.category === 'failed') return 'danger';
  if (task.category === 'completed') return 'success';
  if (task.category === 'running') return 'info';
  if (task.category === 'cancelled') return 'neutral';
  const state = task.state.name.toLowerCase();
  if (state.includes('error') || state.includes('fail')) return 'danger';
  if (state.includes('complete') || state.includes('success')) return 'success';
  if (task.progress > 0 || state.includes('progress')) return 'info';
  return 'warning';
}
