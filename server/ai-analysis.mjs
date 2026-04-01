const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'
const DEFAULT_TIMEOUT_MS = 12000
const MAX_DRIVE_OPPORTUNITIES = 6
const MAX_CROSS_DRIVE_SUGGESTIONS = 4

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

function trimText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function getTimeoutMs() {
  return Math.max(3000, clampNumber(process.env.DEEPSEEK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS))
}

export function getAiRuntimeConfig() {
  const enabledByFlag = process.env.AI_ANALYSIS_ENABLED !== 'false'
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()

  return {
    enabled: Boolean(enabledByFlag && apiKey),
    provider: 'DeepSeek',
    model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL,
    timeoutMs: getTimeoutMs(),
  }
}

function buildDrivePrompt(input) {
  const candidatePaths = new Set([
    `${input.drive.letter}:\\`,
    ...input.topEntries.map((entry) => entry.path),
    ...input.focusDirectories.map((group) => group.path),
    ...input.focusDirectories.flatMap((group) => group.children.map((entry) => entry.path)),
    ...input.notableFiles.map((entry) => entry.path),
  ])

  return {
    system: [
      '你是一个磁盘容量分析助手。',
      '你只能输出严格 JSON，不要输出 Markdown，不要输出解释文字。',
      '请使用中文。',
      '请优先给出可执行、可落地、低幻觉的磁盘整理建议。',
    ].join(' '),
    user: JSON.stringify(
      {
        task: '分析当前磁盘的空间结构，生成摘要、清理机会和整理建议。',
        outputSchema: {
          summary: 'string',
          opportunities: [
            {
              title: 'string',
              action: 'string',
              category: 'string',
              severity: 'critical | warning | info',
              path: 'must be one of candidatePaths',
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
          '只使用输入里已经出现的信息，不要编造不存在的文件或目录。',
          'path 必须从 candidatePaths 中选择；如果没有合适对象，请使用盘符根路径。',
          '机会项最多返回 6 条，指导建议最多返回 3 条。',
          'estimatedBytes 必须是数字，尽量与输入的大小保持一致或保守估计。',
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

function buildCrossDrivePrompt(input) {
  return {
    system: [
      '你是一个磁盘治理与目录标准化助手。',
      '你只能输出严格 JSON，不要输出 Markdown，不要输出解释文字。',
      '请使用中文，输出偏向工程治理和长期维护。',
    ].join(' '),
    user: JSON.stringify(
      {
        task: '基于多盘结构，输出跨盘标准化建议。',
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
          '建议最多返回 4 条。',
          '不要输出泛泛而谈的建议，要结合输入里的真实目录与盘符分布。',
          '不要杜撰不存在的软件、目录或盘符。',
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
      throw new Error(`DeepSeek API ${response.status}: ${message.slice(0, 240)}`)
    }

    return response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function requestDeepSeekJson(prompt) {
  const config = getAiRuntimeConfig()
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()

  if (!config.enabled || !apiKey) {
    return null
  }

  const response = await postJson(
    new URL('/chat/completions', config.baseUrl).toString(),
    {
      model: config.model,
      temperature: 0.2,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    },
    config.timeoutMs,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  )

  const content = response?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('DeepSeek 返回了空内容。')
  }

  return JSON.parse(content)
}

function normalizeDriveOpportunity(letter, item, knownPaths) {
  const fallbackPath = `${letter}:\\`
  const path = typeof item?.path === 'string' && knownPaths.has(item.path) ? item.path : fallbackPath

  return {
    id: `${letter}-${path}-${trimText(item?.title, 'AI 分析机会')}`,
    drive: letter,
    path,
    category: trimText(item?.category, 'ai'),
    severity: normalizeSeverity(item?.severity),
    title: trimText(item?.title, 'AI 分析机会'),
    action: trimText(item?.action, '建议结合当前目录结构进一步确认是否可以整理或迁移。'),
    estimatedBytes: Math.max(0, clampNumber(item?.estimatedBytes)),
  }
}

function normalizeDriveGuidance(items) {
  return (Array.isArray(items) ? items : [])
    .slice(0, 3)
    .map((item, index) => ({
      title: trimText(item?.title, `整理建议 ${index + 1}`),
      detail: trimText(item?.detail, '建议结合当前盘的职责和主要占用内容做进一步规划。'),
      tone: normalizeTone(item?.tone),
    }))
}

export async function analyzeDriveWithAi(input) {
  const config = getAiRuntimeConfig()
  if (!config.enabled) return null

  const prompt = buildDrivePrompt(input)
  const result = await requestDeepSeekJson(prompt)
  const knownPaths = new Set(prompt.user ? JSON.parse(prompt.user).candidatePaths : [])

  return {
    summary: trimText(result?.summary, ''),
    opportunities: (Array.isArray(result?.opportunities) ? result.opportunities : [])
      .slice(0, MAX_DRIVE_OPPORTUNITIES)
      .map((item) => normalizeDriveOpportunity(input.drive.letter, item, knownPaths)),
    guidance: normalizeDriveGuidance(result?.guidance),
  }
}

export async function analyzeCrossDriveWithAi(input) {
  const config = getAiRuntimeConfig()
  if (!config.enabled) return null

  const prompt = buildCrossDrivePrompt(input)
  const result = await requestDeepSeekJson(prompt)

  return {
    summary: trimText(result?.summary, ''),
    standardizationSuggestions: (Array.isArray(result?.standardizationSuggestions)
      ? result.standardizationSuggestions
      : []
    )
      .slice(0, MAX_CROSS_DRIVE_SUGGESTIONS)
      .map((item, index) => ({
        title: trimText(item?.title, `标准化建议 ${index + 1}`),
        detail: trimText(item?.detail, '建议结合真实目录结构进一步整理。'),
      })),
  }
}
