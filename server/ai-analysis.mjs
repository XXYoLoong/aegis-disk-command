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
      '只允许输出严格 JSON，不要输出 Markdown，也不要输出解释性前后缀。',
      '请使用中文，且只基于输入中真实存在的数据做判断。',
      '优先给出可执行、低幻觉、适合本地磁盘整理的建议。',
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
          '不能编造不存在的文件、目录、应用或扫描结果。',
          'path 必须从 candidatePaths 中选择；如果没有合适对象，请使用盘符根路径。',
          '机会项最多返回 6 条，指导建议最多返回 3 条。',
          'estimatedBytes 必须是数字，并尽量贴近输入中的真实大小。',
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
      '只允许输出严格 JSON，不要输出 Markdown，也不要输出解释性前后缀。',
      '请用中文输出偏工程治理和长期维护视角的建议。',
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
          '不要输出泛泛而谈的建议，要结合输入中的真实目录和盘符分布。',
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

function buildChatPrompt(input) {
  return {
    system: [
      '你是 Aegis Disk Command 的磁盘分析对话助手。',
      '你正在回答用户关于某个磁盘当前扫描结果的问题。',
      '只基于输入中的真实扫描结果和历史对话回答，不要编造不存在的数据。',
      '请使用中文，回答要具体、实用、可操作。',
    ].join(' '),
    messages: [
      {
        role: 'system',
        content: JSON.stringify(
          {
            task: '基于盘符分析结果回答用户问题。',
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
      { role: 'user', content: input.message },
    ],
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

function extractJson(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('DeepSeek 返回了空内容。')
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

  throw new Error('DeepSeek 未返回可解析的 JSON。')
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
      max_tokens: 1600,
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
  return extractJson(content)
}

async function requestDeepSeekChat(prompt) {
  const config = getAiRuntimeConfig()
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()

  if (!config.enabled || !apiKey) {
    return null
  }

  const response = await postJson(
    new URL('/chat/completions', config.baseUrl).toString(),
    {
      model: config.model,
      temperature: 0.25,
      max_tokens: 1200,
      messages: prompt.messages,
    },
    config.timeoutMs,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  )

  const content = response?.choices?.[0]?.message?.content
  return trimText(content, '暂时无法生成回答，请稍后再试。')
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

export async function chatWithDriveContext(input) {
  const config = getAiRuntimeConfig()
  if (!config.enabled) {
    return '当前未启用 DeepSeek，对话能力暂不可用。'
  }

  const prompt = buildChatPrompt({
    drive: input.drive,
    summary: input.summary,
    opportunities: input.opportunities,
    topEntries: input.topEntries,
    focusDirectories: input.focusDirectories,
    notableFiles: input.notableFiles,
    aiGuidance: input.aiGuidance,
    crossDriveSummary: input.crossDriveSummary,
    history: Array.isArray(input.history) ? input.history.slice(-8) : [],
    message: input.message,
  })

  return requestDeepSeekChat(prompt)
}
