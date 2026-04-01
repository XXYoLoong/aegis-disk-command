import type { LanguageMode } from '../types'

function normalizeLocale(locale: LanguageMode) {
  return locale === 'en-US' ? 'en-US' : 'zh-CN'
}

export function formatBytes(value: number, locale: LanguageMode = 'zh-CN') {
  if (!Number.isFinite(value) || value <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** exponent
  const fractionDigits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2
  const formatter = new Intl.NumberFormat(normalizeLocale(locale), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })

  return `${formatter.format(amount)} ${units[exponent]}`
}

export function formatPercent(value: number, locale: LanguageMode = 'zh-CN') {
  const safeValue = Number.isFinite(value) ? value : 0
  return `${new Intl.NumberFormat(normalizeLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(safeValue)}%`
}

export function formatNumber(value: number, locale: LanguageMode = 'zh-CN') {
  return new Intl.NumberFormat(normalizeLocale(locale)).format(Number.isFinite(value) ? value : 0)
}

export function formatDurationMs(value: number | null, locale: LanguageMode = 'zh-CN') {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return locale === 'en-US' ? 'Pending' : '待完成'
  }

  if (value < 1000) return `${Math.round(value)} ms`

  if (value < 60_000) {
    return locale === 'en-US' ? `${(value / 1000).toFixed(1)} sec` : `${(value / 1000).toFixed(1)} 秒`
  }

  return locale === 'en-US' ? `${(value / 60_000).toFixed(1)} min` : `${(value / 60_000).toFixed(1)} 分钟`
}

export function formatUpdatedAt(value: string | null, locale: LanguageMode = 'zh-CN') {
  if (!value) {
    return locale === 'en-US' ? 'Waiting for the first analysis' : '等待首次分析'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return locale === 'en-US' ? 'Waiting for the first analysis' : '等待首次分析'
  }

  return new Intl.DateTimeFormat(normalizeLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed)
}

export function shortPath(value: string) {
  if (!value) return '--'
  if (value.length <= 72) return value
  return `${value.slice(0, 28)}...${value.slice(-36)}`
}
