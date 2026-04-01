export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  )
  const amount = value / 1024 ** exponent
  const fractionDigits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2

  return `${amount.toFixed(fractionDigits)} ${units[exponent]}`
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function formatUpdatedAt(value: string | null) {
  if (!value) return '等待首次分析'

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export function shortPath(value: string) {
  if (value.length <= 60) return value
  return `${value.slice(0, 24)}…${value.slice(-32)}`
}
