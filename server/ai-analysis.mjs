const MAX_DRIVE_OPPORTUNITIES = 6
const MAX_CROSS_DRIVE_SUGGESTIONS = 4

function trimText(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function clampNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeSeverity(value) {
  if (value === 'critical' || value === 'warning' || value === 'info') return value
  return 'info'
}

function normalizeTone(value) {
  if (value === 'critical' || value === 'warning' || value === 'stable' || value === 'info') {
    return value
  }
  return 'info'
}

function createLanguageGuide(runtime) {
  if (runtime.language === 'en-US') {
    return {
      outputLanguage: 'English',
      strictHint: 'Do not mix in Chinese except when quoting original file names or paths.',
    }
  }

  return {
    outputLanguage: '中文',
    strictHint: '除非是路径、文件名或模型名，否则不要混入英文术语。',
  }
}

function createStyleGuide(runtime) {
  if (runtime.reportStyle === 'gov-report') {
    if (runtime.language === 'en-US') {
      return 'Use a formal governance-report tone. Treat each drive as a governed region, emphasize current achievements, structural pressure, and next-step actions.'
    }
    return '请使用中国政府工作报告式的治理语气，把每个盘视作一个重点治理地区，强调总体态势、结构性压力、阶段性成效和下一步工作安排。'
  }

  if (runtime.language === 'en-US') {
    return 'Use a practical operator tone focused on diagnosis and action.'
  }

  return '请使用默认的运维分析语气，强调诊断结论和可执行动作。'
}

function buildDrivePrompt(input, runtime) {
  const languageGuide = createLanguageGuide(runtime)
  const styleGuide = createStyleGuide(runtime)
  const candidatePaths = new Set([
    `${input.drive.letter}:\\`,
    ...input.topEntries.map((entry) => entry.path),
    ...input.focusDirectories.map((group) => group.path),
    ...input.focusDirectories.flatMap((group) => group.children.map((entry) => entry.path)),
    ...input.notableFiles.map((entry) => entry.path),
  ])

  return {
    system:
      runtime.language === 'en-US'
        ? `You are a disk-governance analyst. Return strict JSON only. ${languageGuide.strictHint} ${styleGuide}`
        : `你是一名磁盘治理分析助手。只返回严格 JSON。${languageGuide.strictHint} ${styleGuide}`,
    user: JSON.stringify(
      {
        task:
          runtime.language === 'en-US'
            ? 'Analyze the current drive and return a concise summary, cleanup opportunities, and governance guidance.'
            : '分析当前磁盘，返回摘要、清理机会和治理建议。',
        outputLanguage: languageGuide.outputLanguage,
        outputSchema: {
          summary: 'string',
          opportunities: [
            {
              title: 'string',
              action: 'string',
              category: 'string',
              severity: 'critical | warning | info',
              path: 'must be chosen from candidatePaths',
              estimatedBytes: 'number',
            },
          ],
          guidance: [
            {
              title: 'string',
              detail: 'string',
              tone: 'critical | warning | stable | info',
            },
          ],
        },
        rules: [
          runtime.language === 'en-US'
            ? 'Do not invent files, folders, applications, or scan results.'
            : '不要编造不存在的文件、目录、应用或扫描结果。',
          runtime.language === 'en-US'
            ? 'Each opportunity path must come from candidatePaths. If nothing matches, use the drive root.'
            : '每条机会项的 path 必须来自 candidatePaths；如果没有合适对象，使用盘符根路径。',
          runtime.language === 'en-US'
            ? `Return at most ${MAX_DRIVE_OPPORTUNITIES} opportunities and 4 guidance items.`
            : `最多返回 ${MAX_DRIVE_OPPORTUNITIES} 条机会项和 4 条治理建议。`,
        ],
        drive: input.drive,
        candidatePaths: [...candidatePaths],
        topEntries: input.topEntries,
        focusDirectories: input.focusDirectories,
        notableFiles: input.notableFiles,
        fallbackOpportunities: input.fallbackOpportunities,
      },
      null,
      2,
    ),
  }
}

function buildCrossDrivePrompt(input, runtime) {
  const languageGuide = createLanguageGuide(runtime)
  const styleGuide = createStyleGuide(runtime)

  return {
    system:
      runtime.language === 'en-US'
        ? `You are a cross-drive governance analyst. Return strict JSON only. ${languageGuide.strictHint} ${styleGuide}`
        : `你是一名跨盘治理分析助手。只返回严格 JSON。${languageGuide.strictHint} ${styleGuide}`,
    user: JSON.stringify(
      {
        task:
          runtime.language === 'en-US'
            ? 'Return cross-drive normalization suggestions and a short governance summary.'
            : '返回跨盘标准化建议和简短治理总结。',
        outputLanguage: languageGuide.outputLanguage,
        outputSchema: {
          summary: 'string',
          standardizationSuggestions: [
            {
              title: 'string',
              detail: 'string',
            },
          ],
        },
        rules: [
          runtime.language === 'en-US'
            ? `Return at most ${MAX_CROSS_DRIVE_SUGGESTIONS} suggestions.`
            : `最多返回 ${MAX_CROSS_DRIVE_SUGGESTIONS} 条建议。`,
          runtime.language === 'en-US'
            ? 'Do not invent directories, providers, or drive letters.'
            : '不要编造目录、供应商或盘符。',
        ],
        drives: input.drives,
        duplicateTopLevelNames: input.duplicateTopLevelNames,
        topOpportunities: input.topOpportunities,
        fallbackSuggestions: input.fallbackSuggestions,
      },
      null,
      2,
    ),
  }
}

function buildChatPrompt(input, runtime) {
  const languageGuide = createLanguageGuide(runtime)
  const styleGuide = createStyleGuide(runtime)
  return {
    system:
      runtime.language === 'en-US'
        ? `You are the Aegis Disk Command follow-up assistant. Use only the provided scan evidence. ${languageGuide.strictHint} ${styleGuide}`
        : `你是 Aegis Disk Command 的追问式分析助手。只能基于提供的扫描证据回答。${languageGuide.strictHint} ${styleGuide}`,
    messages: [
      {
        role: 'system',
        content: JSON.stringify(
          {
            drive: input.drive,
            summary: input.summary,
            opportunities: input.opportunities,
            topEntries: input.topEntries,
            focusDirectories: input.focusDirectories,
            notableFiles: input.notableFiles,
            aiGuidance: input.aiGuidance,
            crossDriveSummary: input.crossDriveSummary,
          },
          null,
          2,
        ),
      },
      ...input.history,
      {
        role: 'user',
        content: input.message,
      },
    ],
  }
}

function joinUrl(baseUrl, suffix) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '')
  const normalizedSuffix = String(suffix || '').replace(/^\/+/, '')
  return `${normalizedBase}/${normalizedSuffix}`
}

async function postJson(url, body, timeoutMs, headers) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(`${response.status} ${message.slice(0, 320)}`)
    }

    return response.json()
  } finally {
    clearTimeout(timer)
  }
}

function extractJson(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('AI 返回了空内容。')
  }

  const trimmed = content.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed)
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  if (fenceMatch?.[1]) {
    return JSON.parse(fenceMatch[1])
  }

  const objectStart = trimmed.indexOf('{')
  const objectEnd = trimmed.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    return JSON.parse(trimmed.slice(objectStart, objectEnd + 1))
  }

  throw new Error('AI 未返回可解析的 JSON。')
}

function normalizeRuntime(runtime) {
  return {
    enabled: Boolean(runtime?.apiKey),
    providerId: runtime?.providerId ?? 'deepseek',
    providerName: runtime?.provider?.en ?? runtime?.provider?.zh ?? 'DeepSeek',
    protocol: runtime?.protocol ?? 'openai-chat',
    baseUrl: trimText(runtime?.baseUrl),
    model: trimText(runtime?.model),
    timeoutMs: Math.max(3000, clampNumber(runtime?.timeoutMs, 12000)),
    apiKey: trimText(runtime?.apiKey),
    language: runtime?.language === 'en-US' ? 'en-US' : 'zh-CN',
    reportStyle: runtime?.reportStyle === 'gov-report' ? 'gov-report' : 'default',
    docsUrl: trimText(runtime?.docsUrl),
  }
}

export function getAiRuntimeConfig(runtime) {
  const normalized = normalizeRuntime(runtime)
  return {
    enabled: normalized.enabled,
    providerId: normalized.providerId,
    provider: normalized.providerName,
    model: normalized.model,
    baseUrl: normalized.baseUrl,
    timeoutMs: normalized.timeoutMs,
    language: normalized.language,
    reportStyle: normalized.reportStyle,
    docsUrl: normalized.docsUrl,
  }
}

async function requestOpenAiCompatJson(prompt, runtime) {
  const response = await postJson(
    joinUrl(runtime.baseUrl, 'chat/completions'),
    {
      model: runtime.model,
      temperature: 0.2,
      max_tokens: 1800,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    },
    runtime.timeoutMs,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runtime.apiKey}`,
    },
  )

  return extractJson(response?.choices?.[0]?.message?.content)
}

async function requestOpenAiCompatChat(prompt, runtime) {
  const response = await postJson(
    joinUrl(runtime.baseUrl, 'chat/completions'),
    {
      model: runtime.model,
      temperature: 0.3,
      max_tokens: 1800,
      messages: [{ role: 'system', content: prompt.system }, ...prompt.messages],
    },
    runtime.timeoutMs,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runtime.apiKey}`,
    },
  )

  return trimText(response?.choices?.[0]?.message?.content, '')
}

async function requestAnthropicJson(prompt, runtime) {
  const response = await postJson(
    joinUrl(runtime.baseUrl, 'v1/messages'),
    {
      model: runtime.model,
      max_tokens: 1800,
      temperature: 0.2,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    },
    runtime.timeoutMs,
    {
      'Content-Type': 'application/json',
      'x-api-key': runtime.apiKey,
      'anthropic-version': '2023-06-01',
    },
  )

  const content = Array.isArray(response?.content)
    ? response.content
        .filter((item) => item?.type === 'text' && item.text)
        .map((item) => item.text)
        .join('\n')
    : ''

  return extractJson(content)
}

async function requestAnthropicChat(prompt, runtime) {
  const response = await postJson(
    joinUrl(runtime.baseUrl, 'v1/messages'),
    {
      model: runtime.model,
      max_tokens: 1800,
      temperature: 0.3,
      system: prompt.system,
      messages: prompt.messages,
    },
    runtime.timeoutMs,
    {
      'Content-Type': 'application/json',
      'x-api-key': runtime.apiKey,
      'anthropic-version': '2023-06-01',
    },
  )

  return trimText(
    Array.isArray(response?.content)
      ? response.content
          .filter((item) => item?.type === 'text' && item.text)
          .map((item) => item.text)
          .join('\n')
      : '',
    '',
  )
}

async function requestStructuredJson(prompt, runtime) {
  if (!runtime.enabled) return null
  if (runtime.protocol === 'anthropic-messages') {
    return requestAnthropicJson(prompt, runtime)
  }
  return requestOpenAiCompatJson(prompt, runtime)
}

async function requestChatText(prompt, runtime) {
  if (!runtime.enabled) return null
  if (runtime.protocol === 'anthropic-messages') {
    return requestAnthropicChat(prompt, runtime)
  }
  return requestOpenAiCompatChat(prompt, runtime)
}

export async function analyzeDriveWithAi(input, runtimeInput) {
  const runtime = normalizeRuntime(runtimeInput)
  const result = await requestStructuredJson(buildDrivePrompt(input, runtime), runtime)
  if (!result) return null

  return {
    summary: trimText(result.summary, runtime.language === 'en-US' ? 'No summary returned.' : '未返回摘要。'),
    opportunities: Array.isArray(result.opportunities)
      ? result.opportunities.slice(0, MAX_DRIVE_OPPORTUNITIES).map((item, index) => ({
          id: `${input.drive.letter}-ai-${index}`,
          drive: input.drive.letter,
          path: trimText(item.path, `${input.drive.letter}:\\`),
          category: trimText(item.category, 'ai'),
          severity: normalizeSeverity(item.severity),
          title: trimText(item.title, runtime.language === 'en-US' ? 'Suggested action' : '建议事项'),
          action: trimText(item.action, runtime.language === 'en-US' ? 'Review this path.' : '建议检查该路径。'),
          estimatedBytes: Math.max(0, clampNumber(item.estimatedBytes)),
        }))
      : [],
    guidance: Array.isArray(result.guidance)
      ? result.guidance.slice(0, 4).map((item) => ({
          title: trimText(item.title, runtime.language === 'en-US' ? 'Guidance' : '治理建议'),
          detail: trimText(item.detail, runtime.language === 'en-US' ? 'No detail provided.' : '未提供详细说明。'),
          tone: normalizeTone(item.tone),
        }))
      : [],
  }
}

export async function analyzeCrossDriveWithAi(input, runtimeInput) {
  const runtime = normalizeRuntime(runtimeInput)
  const result = await requestStructuredJson(buildCrossDrivePrompt(input, runtime), runtime)
  if (!result) return null

  return {
    summary: trimText(result.summary, runtime.language === 'en-US' ? 'No cross-drive summary returned.' : '未返回跨盘摘要。'),
    standardizationSuggestions: Array.isArray(result.standardizationSuggestions)
      ? result.standardizationSuggestions.slice(0, MAX_CROSS_DRIVE_SUGGESTIONS).map((item) => ({
          title: trimText(item.title, runtime.language === 'en-US' ? 'Standardization suggestion' : '标准化建议'),
          detail: trimText(item.detail, runtime.language === 'en-US' ? 'No detail provided.' : '未提供详细说明。'),
        }))
      : [],
  }
}

export async function chatWithDriveContext(input, runtimeInput) {
  const runtime = normalizeRuntime(runtimeInput)
  const reply = await requestChatText(buildChatPrompt(input, runtime), runtime)
  return trimText(reply, runtime.language === 'en-US' ? 'No answer returned.' : '未返回回答。')
}
