export const PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    order: 1,
    protocol: 'openai-chat',
    names: { zh: '深度求索', en: 'DeepSeek' },
    description: {
      zh: '默认供应商，优先用于结构化磁盘分析。',
      en: 'Default provider for structured disk analysis.',
    },
    envKey: 'DEEPSEEK_API_KEY',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    docsUrl: 'https://api-docs.deepseek.com/api/create-chat-completion/',
  },
  {
    id: 'qwen',
    order: 2,
    protocol: 'openai-chat',
    names: { zh: '通义千问', en: 'Qwen' },
    description: {
      zh: '阿里云百炼兼容模式，适合中国区使用。',
      en: 'Alibaba DashScope compatibility mode.',
    },
    envKey: 'DASHSCOPE_API_KEY',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
  },
  {
    id: 'zhipu',
    order: 3,
    protocol: 'openai-chat',
    names: { zh: '智谱', en: 'Zhipu' },
    description: {
      zh: '智谱大模型开放平台，支持自定义模型。',
      en: 'Zhipu big-model platform with editable model selection.',
    },
    envKey: 'ZHIPU_API_KEY',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.5',
    docsUrl: 'https://open.bigmodel.cn/',
  },
  {
    id: 'doubao',
    order: 4,
    protocol: 'openai-chat',
    names: { zh: '豆包', en: 'Doubao' },
    description: {
      zh: '火山方舟兼容模式，可接豆包与其他模型。',
      en: 'Volcengine Ark compatibility mode.',
    },
    envKey: 'ARK_API_KEY',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-6-250615',
    docsUrl: 'https://www.volcengine.com/docs',
  },
  {
    id: 'kimi',
    order: 5,
    protocol: 'openai-chat',
    names: { zh: '月之暗面', en: 'Kimi' },
    description: {
      zh: 'Moonshot 兼容模式，适合长上下文问答。',
      en: 'Moonshot compatibility mode for long-context use cases.',
    },
    envKey: 'MOONSHOT_API_KEY',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-0711-preview',
    docsUrl: 'https://platform.moonshot.cn/blog',
  },
  {
    id: 'openai',
    order: 6,
    protocol: 'openai-chat',
    names: { zh: '开放智能', en: 'OpenAI' },
    description: {
      zh: 'OpenAI 官方接口，适合通用高质量分析。',
      en: 'Official OpenAI API for general high-quality analysis.',
    },
    envKey: 'OPENAI_API_KEY',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.2-chat-latest',
    docsUrl: 'https://developers.openai.com/api/',
  },
  {
    id: 'google',
    order: 7,
    protocol: 'openai-chat',
    names: { zh: '谷歌', en: 'Google' },
    description: {
      zh: 'Gemini 的 OpenAI 兼容入口。',
      en: 'Gemini via the OpenAI compatibility entrypoint.',
    },
    envKey: 'GOOGLE_API_KEY',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
  },
  {
    id: 'claude',
    order: 8,
    protocol: 'anthropic-messages',
    names: { zh: '克劳德', en: 'Claude' },
    description: {
      zh: 'Anthropic Messages 接口。',
      en: 'Anthropic Messages API.',
    },
    envKey: 'ANTHROPIC_API_KEY',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    docsUrl: 'https://docs.anthropic.com/en/api/messages-examples',
  },
  {
    id: 'openrouter',
    order: 9,
    protocol: 'openai-chat',
    names: { zh: '开放路由', en: 'OpenRouter' },
    description: {
      zh: '可聚合多家模型，便于试用与切换。',
      en: 'Aggregator for trying multiple model families.',
    },
    envKey: 'OPENROUTER_API_KEY',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    docsUrl: 'https://openrouter.ai/docs/api-reference/overview',
  },
  {
    id: 'siliconflow',
    order: 10,
    protocol: 'openai-chat',
    names: { zh: '硅基流动', en: 'SiliconFlow' },
    description: {
      zh: '适合在国内环境下接入开源模型。',
      en: 'Convenient for accessing open-source models in CN regions.',
    },
    envKey: 'SILICONFLOW_API_KEY',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen3-32B',
    docsUrl: 'https://docs.siliconflow.cn/',
  },
]

export function getProviderCatalog() {
  return [...PROVIDER_PRESETS].sort((a, b) => a.order - b.order)
}

export function getProviderPreset(providerId) {
  return getProviderCatalog().find((provider) => provider.id === providerId) ?? getProviderCatalog()[0]
}

export function buildDefaultProviderSettings() {
  return Object.fromEntries(
    getProviderCatalog().map((provider) => [
      provider.id,
      {
        baseUrl: provider.defaultBaseUrl,
        model: provider.defaultModel,
        timeoutMs: 12000,
      },
    ]),
  )
}
