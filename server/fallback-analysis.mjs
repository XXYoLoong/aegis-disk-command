function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword))
}

function rankSeverity(weight) {
  if (weight >= 2.5) return 'critical'
  if (weight >= 1.5) return 'warning'
  return 'info'
}

function isEnglish(language) {
  return language === 'en-US'
}

function getHeuristicHit(rawName, language) {
  const name = String(rawName ?? '').toLowerCase()
  const english = isEnglish(language)

  if (includesAny(name, ['$recycle', 'recycle', '回收'])) {
    return {
      category: 'reclaim',
      title: english ? 'Recycle area can release space quickly' : '回收区域可直接释放空间',
      action: english
        ? 'Empty the recycle area after confirming nothing needs to be restored.'
        : '确认没有需要恢复的文件后，优先清空回收区域。',
      weight: 2.7,
    }
  }

  if (includesAny(name, ['cache', 'temp', 'logs', 'tmp', '缓存', '临时', '日志'])) {
    return {
      category: 'cache',
      title: english ? 'Heavy cache or temporary directory detected' : '检测到高占用缓存或临时目录',
      action: english
        ? 'Review whether the content is disposable cache, logs, or temporary data before cleanup.'
        : '先确认是否属于缓存、日志或临时文件，再做清理。',
      weight: 1.9,
    }
  }

  if (includesAny(name, ['download', 'installer', 'archive', 'setup', '下载', '安装包', '压缩包'])) {
    return {
      category: 'download',
      title: english ? 'Download or installer repository is growing' : '下载仓或安装包堆积明显',
      action: english
        ? 'Archive only the packages that are still needed and remove or relocate the rest.'
        : '保留仍在使用的安装包，其余内容适合归档或转移。',
      weight: 1.8,
    }
  }

  if (includesAny(name, ['video', 'record', 'clip', 'draft', 'bililive', '视频', '录屏', '剪映', '素材'])) {
    return {
      category: 'media',
      title: english ? 'Media production directory is heavy' : '媒体生产目录占用较高',
      action: english
        ? 'Move finished assets and intermediate exports to archive storage, keep only active working sets locally.'
        : '将已完成素材和中间产物转入归档区，本地只保留当前工作集。',
      weight: 1.6,
    }
  }

  if (includesAny(name, ['docker', 'wsl', 'vhd', 'vmdk', 'emulator', 'virtual', '虚拟', '镜像'])) {
    return {
      category: 'virtualization',
      title: english ? 'Virtual disk or emulator area is heavy' : '虚拟磁盘或模拟器区域偏重',
      action: english
        ? 'Confirm which images are still in active use before trimming or migrating them.'
        : '先确认哪些镜像仍在使用，再决定精简、归档或迁移。',
      weight: 1.5,
    }
  }

  if (includesAny(name, ['huawei', 'deveco', 'openharmony', 'sdk', 'android', 'toolchain', '开发', '工具链'])) {
    return {
      category: 'toolchain',
      title: english ? 'Toolchain or SDK zone is fragmented' : '工具链或 SDK 区域偏重',
      action: english
        ? 'Consolidate development stacks into a unified root directory by ecosystem and version.'
        : '建议把开发工具链按生态和版本统一收拢到固定根目录。',
      weight: 1.4,
    }
  }

  if (includesAny(name, ['onedrive', 'desktop', 'documents', 'sync', '桌面', '文档', '同步'])) {
    return {
      category: 'sync',
      title: english ? 'Synchronized area is carrying large content' : '同步目录承载了较大内容',
      action: english
        ? 'Keep only the content that truly needs syncing; move installers and bulk assets out of sync folders.'
        : '仅保留必须同步的内容，把安装包和大素材移出同步目录。',
      weight: 1.4,
    }
  }

  if (includesAny(name, ['steam', 'wegame', 'mihoyo', 'game', '游戏'])) {
    return {
      category: 'games',
      title: english ? 'Game library is occupying significant space' : '游戏库占用明显',
      action: english
        ? 'Avoid parallel installations of the same title across multiple launchers.'
        : '建议按平台统一整理游戏库，避免同一游戏多平台重复安装。',
      weight: 1.2,
    }
  }

  return null
}

export function buildFallbackOpportunities(letter, entries, language) {
  return entries
    .map((entry) => {
      const hit = getHeuristicHit(entry.path, language)
      if (!hit) return null
      return {
        id: `${letter}-${entry.path}`,
        drive: letter,
        path: entry.path,
        category: hit.category,
        severity: rankSeverity(hit.weight + entry.sizeBytes / 150_000_000_000),
        title: hit.title,
        action: hit.action,
        estimatedBytes: entry.sizeBytes,
      }
    })
    .filter(Boolean)
}

export function fallbackStandardizationSuggestions(language) {
  const english = isEnglish(language)
  return [
    {
      title: english ? 'Unify the download intake path' : '统一下载入口',
      detail: english
        ? 'Put installers, cloud-drive downloads, and temporary setup files under one controlled archive root.'
        : '把安装包、网盘下载和临时 setup 统一汇总到受控归档根目录。',
    },
    {
      title: english ? 'Separate sync zones from temporary zones' : '同步区和临时区分层',
      detail: english
        ? 'Keep only durable synced files in cloud folders and move bulky assets or installers elsewhere.'
        : '同步目录只保留真正需要同步的内容，把大素材和安装包迁出。',
    },
    {
      title: english ? 'Consolidate duplicated toolchains' : '收拢重复工具链',
      detail: english
        ? 'Bring DevEco, Huawei SDK, OpenHarmony resources, and emulator images into one governed toolchain root.'
        : '将 DevEco、Huawei SDK、OpenHarmony 资源和模拟器镜像统一收拢到工具链根目录。',
    },
    {
      title: english ? 'Normalize game-library ownership' : '按平台规范游戏库',
      detail: english
        ? 'Keep a single authoritative installation per title whenever possible.'
        : '同一游戏尽量只保留一个主安装入口，减少重复占用。',
    },
  ]
}

export function buildFallbackDriveGuidance(drive, opportunities, language) {
  const english = isEnglish(language)
  const items = []

  if (drive.usePercent >= 92) {
    items.push({
      title: english ? 'Free space is near the safety boundary' : '可用余量已经接近安全边界',
      detail: english
        ? 'Recover space from recycle, downloads, installers, and duplicate environments before anything else.'
        : '建议先从回收区、下载仓、安装包和重复环境回收空间。',
      tone: 'critical',
    })
  } else if (drive.usePercent >= 82) {
    items.push({
      title: english ? 'Capacity pressure has entered warning range' : '已经进入容量预警区间',
      detail: english
        ? 'Complete one targeted cleanup round before large imports, installs, or sync bursts.'
        : '在下一次大安装或同步前，最好先完成一轮针对性清理。',
      tone: 'warning',
    })
  } else {
    items.push({
      title: english ? 'Current free space is relatively stable' : '当前盘面余量相对稳定',
      detail: english
        ? 'This drive can shift from emergency cleanup to structural governance.'
        : '这个盘目前更适合做结构治理，而不是应急清理。',
      tone: 'stable',
    })
  }

  if (opportunities.length > 0) {
    items.push({
      title: english ? 'High-return cleanup clues have been identified' : '已识别出高收益整理线索',
      detail: english
        ? 'The current scan already shows caches, download stores, media folders, or duplicated toolchain areas worth prioritizing.'
        : '当前扫描结果中已经出现缓存区、下载仓、媒体目录或工具链重复面，适合优先处理。',
      tone: 'warning',
    })
  }

  items.push({
    title: english ? 'Keep a single mission for each drive' : '建议保持盘面职责单一',
    detail: english
      ? 'Try to keep one drive aligned to one primary role, such as system, development, games, media, or archive.'
      : '尽量让每个盘承担单一核心任务，例如系统、开发、游戏、媒体或归档。',
    tone: 'info',
  })

  return items
}

export function buildFallbackDriveSummary(drive, topEntries, opportunities, language, reportStyle) {
  const english = isEnglish(language)
  const heaviest = topEntries.slice(0, 3).map((entry) => entry.name).join(english ? ', ' : '、')

  if (reportStyle === 'gov-report') {
    if (english) {
      const level = drive.usePercent >= 90 ? 'high pressure' : drive.usePercent >= 80 ? 'warning-level pressure' : 'stable operation'
      return `The ${drive.letter}: region is currently under ${level}. Key pressure points are concentrated in ${heaviest || 'the scanned hot zones'}. ${opportunities.length > 0 ? `A total of ${opportunities.length} focused governance leads have been identified.` : 'No high-yield governance lead has been identified yet.'}`
    }
    const level = drive.usePercent >= 90 ? '总体压力较大' : drive.usePercent >= 80 ? '已进入预警区间' : '总体运行平稳'
    return `${drive.letter} 盘当前${level}，重点压力主要集中在${heaviest || '已扫描热点区域'}。${opportunities.length > 0 ? `已识别出 ${opportunities.length} 条重点治理线索。` : '暂未识别出明显的高收益治理线索。'}`
  }

  if (english) {
    return `${drive.letter}: is currently ${drive.usePercent >= 90 ? 'under high capacity pressure' : drive.usePercent >= 80 ? 'in a warning state' : 'relatively stable'}. The heaviest top-level areas are ${heaviest || 'not yet available'}, and ${opportunities.length > 0 ? `${opportunities.length} cleanup leads have been identified.` : 'no high-yield cleanup lead has been identified yet.'}`
  }

  return `${drive.letter} 盘当前${drive.usePercent >= 90 ? '容量压力很高' : drive.usePercent >= 80 ? '已进入预警区' : '状态相对稳定'}。最重的顶层区域主要是${heaviest || '暂未形成足够样本'}，${opportunities.length > 0 ? `已发现 ${opportunities.length} 条值得优先检查的整理线索。` : '暂未发现明显的高收益机会位。'}`
}

export function buildFallbackCrossSummary(duplicates, topOpportunities, language, reportStyle) {
  const english = isEnglish(language)
  if (reportStyle === 'gov-report') {
    if (english) {
      if (duplicates.length === 0 && topOpportunities.length === 0) {
        return 'At the system level, no obvious cross-drive duplication or urgent governance signal has been formed yet.'
      }
      if (duplicates.length > 0) {
        return `At the system level, ${duplicates.length} cross-drive duplicate clusters have been identified and should be governed first.`
      }
      return `At the system level, ${topOpportunities.length} high-yield cleanup leads have been identified and should be handled in order of estimated return.`
    }
    if (duplicates.length === 0 && topOpportunities.length === 0) {
      return '从全局看，当前尚未形成明显的跨盘重复面或紧迫治理信号。'
    }
    if (duplicates.length > 0) {
      return `从全局看，已识别出 ${duplicates.length} 组跨盘重复面，建议优先推进治理整合。`
    }
    return `从全局看，已识别出 ${topOpportunities.length} 条高收益治理线索，建议按收益顺序推进。`
  }

  if (english) {
    if (duplicates.length === 0 && topOpportunities.length === 0) {
      return 'No obvious cross-drive duplication or high-priority cleanup signal has appeared yet.'
    }
    if (duplicates.length > 0) {
      return `${duplicates.length} cross-drive duplicate clusters have been identified and should be consolidated first.`
    }
    return `${topOpportunities.length} global cleanup opportunities have been identified and should be handled by estimated return.`
  }

  if (duplicates.length === 0 && topOpportunities.length === 0) {
    return '目前还没有形成明显的跨盘重复面或高优先级整理信号。'
  }
  if (duplicates.length > 0) {
    return `已发现 ${duplicates.length} 组跨盘重名顶层目录，建议优先收拢职责重复的目录。`
  }
  return `全局已识别出 ${topOpportunities.length} 条高收益整理机会，建议按容量收益从高到低处理。`
}
