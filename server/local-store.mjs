import fs from 'node:fs'
import path from 'node:path'
import {
  buildDefaultProviderSettings,
  getProviderCatalog,
  getProviderPreset,
} from './provider-catalog.mjs'

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function parseEnvFile(content) {
  const env = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const delimiterIndex = trimmed.indexOf('=')
    if (delimiterIndex === -1) continue
    const key = trimmed.slice(0, delimiterIndex).trim()
    const rawValue = trimmed.slice(delimiterIndex + 1).trim()
    const value =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue.startsWith("'") && rawValue.endsWith("'")
          ? rawValue.slice(1, -1)
          : rawValue
    env[key] = value
  }
  return env
}

function readEnvSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {}
    return parseEnvFile(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function writeEnvFile(filePath, env) {
  const lines = Object.entries(env)
    .filter(([, value]) => value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8')
}

function maskSecret(secret) {
  if (!secret) return ''
  if (secret.length <= 8) return '已配置'
  return `${secret.slice(0, 3)}***${secret.slice(-3)}`
}

function createDefaultSettings() {
  return {
    ui: {
      themeMode: 'system',
      language: 'zh-CN',
      reportStyle: 'default',
    },
    runtime: {
      selectedProvider: 'deepseek',
      allowOfflineCache: true,
      autoSaveOnlineCache: true,
    },
    providers: buildDefaultProviderSettings(),
  }
}

function normalizeTimeout(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 12000
  return Math.max(3000, Math.min(120000, Math.round(number)))
}

function normalizeSettings(input) {
  const defaults = createDefaultSettings()
  const merged = {
    ui: {
      ...defaults.ui,
      ...(input?.ui ?? {}),
    },
    runtime: {
      ...defaults.runtime,
      ...(input?.runtime ?? {}),
    },
    providers: {
      ...defaults.providers,
      ...(input?.providers ?? {}),
    },
  }

  for (const provider of getProviderCatalog()) {
    const fallback = defaults.providers[provider.id]
    const current = merged.providers[provider.id] ?? fallback
    merged.providers[provider.id] = {
      baseUrl: String(current.baseUrl ?? fallback.baseUrl).trim() || fallback.baseUrl,
      model: String(current.model ?? fallback.model).trim() || fallback.model,
      timeoutMs: normalizeTimeout(current.timeoutMs ?? fallback.timeoutMs),
    }
  }

  if (!getProviderPreset(merged.runtime.selectedProvider)) {
    merged.runtime.selectedProvider = defaults.runtime.selectedProvider
  }

  merged.ui.themeMode = ['system', 'dark', 'light'].includes(merged.ui.themeMode)
    ? merged.ui.themeMode
    : defaults.ui.themeMode
  merged.ui.language = ['zh-CN', 'en-US'].includes(merged.ui.language)
    ? merged.ui.language
    : defaults.ui.language
  merged.ui.reportStyle = ['default', 'gov-report'].includes(merged.ui.reportStyle)
    ? merged.ui.reportStyle
    : defaults.ui.reportStyle
  merged.runtime.allowOfflineCache = merged.runtime.allowOfflineCache !== false
  merged.runtime.autoSaveOnlineCache = merged.runtime.autoSaveOnlineCache !== false

  return merged
}

export function createLocalStore(projectRoot) {
  const localRoot = path.join(projectRoot, '.aegis')
  const settingsPath = path.join(localRoot, 'settings.json')
  const secretsPath = path.join(localRoot, 'local.env')
  const cachePath = path.join(localRoot, 'last-online-cache.json')

  ensureDir(localRoot)

  let settings = normalizeSettings(readJsonSafe(settingsPath, createDefaultSettings()))
  let localSecrets = readEnvSafe(secretsPath)
  let cache = readJsonSafe(cachePath, {
    updatedAt: null,
    providerId: null,
    driveAnalyses: {},
    crossDrive: null,
  })

  function persistSettings() {
    ensureDir(localRoot)
    writeJson(settingsPath, settings)
  }

  function persistSecrets() {
    ensureDir(localRoot)
    writeEnvFile(secretsPath, localSecrets)
  }

  function persistCache() {
    ensureDir(localRoot)
    writeJson(cachePath, cache)
  }

  function getSecret(envKey) {
    return localSecrets[envKey] || process.env[envKey] || ''
  }

  function getProviderClientConfig(providerId) {
    const provider = getProviderPreset(providerId)
    const current = settings.providers[provider.id]
    const secret = getSecret(provider.envKey)
    return {
      id: provider.id,
      names: provider.names,
      description: provider.description,
      docsUrl: provider.docsUrl,
      protocol: provider.protocol,
      baseUrl: current.baseUrl,
      model: current.model,
      timeoutMs: current.timeoutMs,
      apiKeySet: Boolean(secret),
      apiKeyPreview: maskSecret(secret),
    }
  }

  function getClientSettings() {
    return {
      ui: settings.ui,
      runtime: settings.runtime,
      providers: Object.fromEntries(
        getProviderCatalog().map((provider) => [provider.id, getProviderClientConfig(provider.id)]),
      ),
      localPaths: {
        root: localRoot,
        settingsPath,
        secretsPath,
        cachePath,
      },
      setupRequired:
        !getProviderClientConfig(settings.runtime.selectedProvider).apiKeySet &&
        !cache.updatedAt,
      cachedAt: cache.updatedAt,
    }
  }

  function getRuntimeSettings() {
    const selected = settings.runtime.selectedProvider
    const provider = getProviderPreset(selected)
    const current = settings.providers[provider.id]
    return {
      ...settings.ui,
      ...settings.runtime,
      providerId: provider.id,
      provider: provider.names,
      protocol: provider.protocol,
      baseUrl: current.baseUrl,
      model: current.model,
      timeoutMs: current.timeoutMs,
      apiKey: getSecret(provider.envKey).trim(),
      docsUrl: provider.docsUrl,
    }
  }

  function updateSettings(payload) {
    const next = normalizeSettings({
      ...settings,
      ...(payload ?? {}),
      ui: {
        ...settings.ui,
        ...(payload?.ui ?? {}),
      },
      runtime: {
        ...settings.runtime,
        ...(payload?.runtime ?? {}),
      },
      providers: {
        ...settings.providers,
        ...(payload?.providers ?? {}),
      },
    })

    settings = next

    const providerPayload = payload?.providerSecrets ?? {}
    for (const provider of getProviderCatalog()) {
      if (!(provider.id in providerPayload)) continue
      const incoming = providerPayload[provider.id]
      if (incoming === null) {
        delete localSecrets[provider.envKey]
        continue
      }
      if (typeof incoming === 'string') {
        const trimmed = incoming.trim()
        if (trimmed) {
          localSecrets[provider.envKey] = trimmed
        }
      }
    }

    persistSettings()
    persistSecrets()
    return getClientSettings()
  }

  function getCache() {
    return cache
  }

  function updateDriveCache(letter, payload) {
    cache = {
      ...cache,
      updatedAt: new Date().toISOString(),
      providerId: settings.runtime.selectedProvider,
      driveAnalyses: {
        ...(cache.driveAnalyses ?? {}),
        [letter]: payload,
      },
    }
    persistCache()
  }

  function updateCrossDriveCache(payload) {
    cache = {
      ...cache,
      updatedAt: new Date().toISOString(),
      providerId: settings.runtime.selectedProvider,
      crossDrive: payload,
    }
    persistCache()
  }

  function getDriveCache(letter) {
    return cache.driveAnalyses?.[letter] ?? null
  }

  function getCrossDriveCache() {
    return cache.crossDrive ?? null
  }

  persistSettings()

  return {
    paths: {
      root: localRoot,
      settingsPath,
      secretsPath,
      cachePath,
    },
    getSettings: () => settings,
    getClientSettings,
    getRuntimeSettings,
    updateSettings,
    getProviderCatalog: () =>
      getProviderCatalog().map((provider) => getProviderClientConfig(provider.id)),
    getCache,
    getDriveCache,
    getCrossDriveCache,
    updateDriveCache,
    updateCrossDriveCache,
  }
}
