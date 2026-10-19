window.__ModuleLoader__.load({
  id: "dsh-billing-meter",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var ReactDOM = require("react-dom");

    /**
 * DeepSeek 人民币计费策略 —— 峰值/空闲时段与官方价目表（单一事实来源）。
 *
 * 本文件是纯 ES module：只依赖 `Date` 与 `Math`，不碰浏览器或 Node 全局对象，
 * 因此既能被 `test/*.test.mjs` 直接 import，也能被 `scripts/build-client.mjs`
 * 内联进浏览器产物 `lib/client.js`（去掉行首 `export` 关键字即可）。
 *
 * 现行规则（2026-10-19 核对 DeepSeek 官方价格页）：
 *   - 高峰时段：北京时间 周一至周五 09:00–12:00、14:00–18:00，
 *     不含中国法定节假日。
 *   - 其余全部时间（含周末与法定节假日全天）为空闲时段。
 *   - 空闲时段价格为高峰时段价格的 50%。
 *   - 2025 年那套「00:30–08:30 错峰折扣」已于 2025-09-05 取消，不再适用；
 *     `deepseek-chat` / `deepseek-reasoner` 也已下线，不在现行价目表内。
 *
 * 来源：
 *   - 价格页（中文）: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 *   - 价格页（英文）: https://api-docs.deepseek.com/quick_start/pricing
 *   - 价格规则与 2026 节假日表的核对参考: https://github.com/hojas/dsh-price-tip
 *
 * 文档化的假设：
 *   - 高峰窗口按半开区间 `[起, 止)` 处理；官方只写到分钟，未规定秒级边界，
 *     本插件约定 09:00:00 起为高峰、12:00:00 起为空闲。
 *   - 费用按「当前时段」的单价估算整段会话 token（投影只提供累计 token，
 *     不提供每笔请求的时刻）；跨时段会话的精确账单以官方为准。
 *   - 缓存写入（cacheWriteTokens）按「缓存未命中」单价计费：DeepSeek 价格页
 *     只区分命中/未命中，没有独立的缓存写入价。
 */

/** 一分钟的毫秒数。 */
const MINUTE_MS = 60_000;
/** 一天的毫秒数。 */
const DAY_MS = 86_400_000;

/**
 * 2026 年中国大陆法定节假日中落在周一至周五的日期。
 *
 * 周末本身整天空闲，因此周末日期（以及调休上班的周末）不需要列出。
 * 年份未覆盖时界面会标注「按工作日估算」，新增年份直接往这里补日期即可。
 */
const HOLIDAYS_2026 = [
  '2026-01-01', // 元旦
  '2026-01-02', // 元旦
  '2026-02-16', // 春节
  '2026-02-17', // 春节
  '2026-02-18', // 春节
  '2026-02-19', // 春节
  '2026-02-20', // 春节
  '2026-02-23', // 春节
  '2026-04-06', // 清明节
  '2026-05-01', // 劳动节
  '2026-05-04', // 劳动节
  '2026-05-05', // 劳动节
  '2026-06-19', // 端午节
  '2026-09-25', // 中秋节
  '2026-10-01', // 国庆节
  '2026-10-02', // 国庆节
  '2026-10-05', // 国庆节
  '2026-10-06', // 国庆节
  '2026-10-07', // 国庆节
];

/** 计费策略。纯数据，可序列化、可直接断言。 */
const POLICY = {
  /** 本版规则的标识，面板页脚会展示。 */
  id: 'deepseek-cny-peak-offpeak-2026-10',
  /** 人工核对价格页的日期。 */
  verifiedAt: '2026-10-19',
  /** 规则与价格的官方出处。 */
  source: {
    label: 'DeepSeek 官方价格页',
    url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  },
  currency: 'CNY',
  /** 价格单位：元 / 百万 tokens。 */
  priceUnit: 'perMillionTokens',
  schedule: {
    /** 北京时间固定 UTC+8，无夏令时。 */
    utcOffsetMinutes: 480,
    /** 高峰窗口，[起, 止) 分钟数，按北京时间当日 0 点起算。 */
    peakWindows: [
      [9 * 60, 12 * 60], // 09:00–12:00
      [14 * 60, 18 * 60], // 14:00–18:00
    ],
    /** 周末全天为空闲时段。 */
    weekendOffPeak: true,
    /** 落在工作日的法定节假日，全天为空闲时段。 */
    holidays: HOLIDAYS_2026,
    /** 节假日日历覆盖的年份；未覆盖的年份界面标注为估算。 */
    calendarYears: [2026],
  },
  /** 空闲时段 = 高峰价 × 该系数。 */
  offPeakMultiplier: 0.5,
  /**
   * 价目表（高峰价，单位：元 / 百万 tokens）。
   * 空闲价由 `offPeakMultiplier` 推导，避免同一数字写两遍而漂移。
   */
  models: [
    {
      id: 'deepseek-flash',
      label: 'DeepSeek-V4.1-Flash',
      peakPrice: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    },
    {
      id: 'deepseek-v4-pro',
      label: 'DeepSeek-V4-Pro',
      peakPrice: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
      /**
       * 官方口径互相矛盾：价格页仍列 0.30/9.0/27.0，但 2026-09-10 的更新日志
       * 说 v4-pro 请求将路由到 V4.1-Flash 并按 Flash 单价计费。这里以价格页
       * 为准，UI 标注「口径待确认」。
       */
      pricingUncertain: true,
    },
  ],
};

/** 补零到两位。 @param value - 数字。 @returns 两位文本。 */
function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * 把一个时间点拆成北京时间墙钟字段。
 * @param instantMs - epoch 毫秒。
 * @param policy - 提供 UTC 偏移的策略。
 * @returns 北京时间的日期字段与该日 00:00 对应的 epoch 毫秒。
 */
function beijingParts(instantMs, policy = POLICY) {
  const offset = policy.schedule.utcOffsetMinutes * MINUTE_MS;
  const shifted = new Date(instantMs + offset);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  return {
    year,
    month,
    day,
    hour,
    minute,
    second: shifted.getUTCSeconds(),
    /** 0 = 周日 … 6 = 周六 */
    weekday: shifted.getUTCDay(),
    minuteOfDay: hour * 60 + minute,
    dateKey: `${year}-${pad2(month)}-${pad2(day)}`,
    dayStartMs: Date.UTC(year, month - 1, day) - offset,
  };
}

/** 每个策略对象对应的节假日集合缓存。 */
const holidaySets = new WeakMap();

/**
 * 取某个策略的节假日日期集合。
 * @param policy - 策略。
 * @returns 日期集合。
 */
function holidaySet(policy) {
  let set = holidaySets.get(policy);
  if (set === undefined) {
    set = new Set(policy.schedule.holidays);
    holidaySets.set(policy, set);
  }
  return set;
}

/**
 * 判断某个时间点是否按高峰价计费。
 * @param instantMs - epoch 毫秒。
 * @param policy - 计费策略。
 * @returns 工作日、处于高峰窗口内且非节假日时为 true。
 */
function isPeak(instantMs, policy = POLICY) {
  const parts = beijingParts(instantMs, policy);
  const weekend = parts.weekday === 0 || parts.weekday === 6;
  if (weekend && policy.schedule.weekendOffPeak) return false;
  if (holidaySet(policy).has(parts.dateKey)) return false;
  for (const [start, end] of policy.schedule.peakWindows) {
    if (parts.minuteOfDay >= start && parts.minuteOfDay < end) return true;
  }
  return false;
}

/**
 * 某个时间点所处的计费时段。
 * @param instantMs - epoch 毫秒。
 * @param policy - 计费策略。
 * @returns `'peak'` 或 `'off-peak'`。
 */
function periodAt(instantMs, policy = POLICY) {
  return isPeak(instantMs, policy) ? 'peak' : 'off-peak';
}

/**
 * 时段下一次翻转的时间点。
 * @param instantMs - epoch 毫秒。
 * @param policy - 计费策略。
 * @returns 下一次翻转的 epoch 毫秒；三周内找不到时返回 null。
 */
function nextSwitchAt(instantMs, policy = POLICY) {
  const current = isPeak(instantMs, policy);
  const { dayStartMs } = beijingParts(instantMs, policy);
  const candidates = [];
  for (let day = 0; day < 21; day += 1) {
    const base = dayStartMs + day * DAY_MS;
    for (const [start, end] of policy.schedule.peakWindows) {
      candidates.push(base + start * MINUTE_MS, base + end * MINUTE_MS);
    }
  }
  candidates.sort((left, right) => left - right);
  for (const at of candidates) {
    if (at <= instantMs) continue;
    if (isPeak(at, policy) !== current) return at;
  }
  return null;
}

/**
 * UI 需要的「现在」：时段、下次切换、剩余时间、日历覆盖情况。
 * @param instantMs - epoch 毫秒。
 * @param policy - 计费策略。
 * @returns 时段状态。
 */
function statusAt(instantMs, policy = POLICY) {
  const parts = beijingParts(instantMs, policy);
  const next = nextSwitchAt(instantMs, policy);
  let window = null;
  for (const [start, end] of policy.schedule.peakWindows) {
    if (parts.minuteOfDay >= start && parts.minuteOfDay < end) window = [start, end];
  }
  return {
    period: isPeak(instantMs, policy) ? 'peak' : 'off-peak',
    nextSwitchAt: next,
    msUntilSwitch: next === null ? null : Math.max(0, next - instantMs),
    calendarCovered: policy.schedule.calendarYears.includes(parts.year),
    year: parts.year,
    dateKey: parts.dateKey,
    beijingMinuteOfDay: parts.minuteOfDay,
    /** 当前所处（或下一个）高峰窗口的分钟范围，没有则为 null。 */
    window,
  };
}

/**
 * 某个模型在某个时段的实际单价。
 * @param model - 价目表条目。
 * @param period - `'peak'` 或 `'off-peak'`。
 * @param policy - 计费策略。
 * @returns 实际单价、高峰参考价与是否打折。
 */
function priceAt(model, period, policy = POLICY) {
  const factor = period === 'off-peak' ? policy.offPeakMultiplier : 1;
  return {
    currency: policy.currency,
    effective: {
      cacheHit: model.peakPrice.cacheHit * factor,
      cacheMiss: model.peakPrice.cacheMiss * factor,
      output: model.peakPrice.output * factor,
    },
    standard: model.peakPrice,
    discounted: factor !== 1,
  };
}

/**
 * 把一个模型 id 或展示名映射到价目表条目。
 *
 * 兼容官方 id（deepseek-flash / deepseek-v4-pro）与各 provider 的展示名
 * （如 Trae 的 `DeepSeek-V4-Flash-Official`、WorkBuddy 的 `deepseek-v4.1-flash`、
 * Qoder 的 `DeepSeek-Flash`）。非 DeepSeek 模型返回 null —— 没有官方人民币价。
 * @param modelId - 会话 modelSelection 里的模型 id/名称。
 * @param policy - 计费策略。
 * @returns 价目表条目或 null。
 */
function resolveModel(modelId, policy = POLICY) {
  if (typeof modelId !== 'string' || modelId === '') return null;
  const key = modelId.toLowerCase().replace(/[\s_]+/g, '-');
  for (const model of policy.models) {
    if (key === model.id) return model;
  }
  if (!key.includes('deepseek')) return null;
  if (key.includes('pro')) {
    return policy.models.find((model) => model.id === 'deepseek-v4-pro') ?? null;
  }
  if (key.includes('flash')) {
    return policy.models.find((model) => model.id === 'deepseek-flash') ?? null;
  }
  return null;
}

/**
 * 把 tokenUsage 投影值规整成四个计费桶。
 *
 * 兼容三种形状：wire 视图的扁平对象、投影 state 的 `{ totals }`、
 * 以及 `{ last: { buckets } }`。缺字段按 0 处理，负数与非法值也归 0。
 * @param usage - tokenUsage 投影值。
 * @returns 四个计费桶。
 */
function usageOf(usage) {
  const pick = (value, key) => {
    const number = value === null || value === undefined ? 0 : value[key];
    return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : 0;
  };
  let source = usage ?? {};
  if (source.totals !== undefined && source.totals !== null) source = source.totals;
  else if (source.last !== undefined && source.last !== null && source.last.buckets !== undefined) {
    source = source.last.buckets;
  }
  return {
    uncachedInputTokens: pick(source, 'uncachedInputTokens'),
    outputTokens: pick(source, 'outputTokens'),
    cacheReadTokens: pick(source, 'cacheReadTokens'),
    cacheWriteTokens: pick(source, 'cacheWriteTokens'),
  };
}

/**
 * 按给定单价计算四个桶各自的人民币费用。
 * @param buckets - 四个计费桶。
 * @param prices - 单价（元 / 百万 tokens）。
 * @returns 分桶费用与合计（元）。
 */
function costOf(buckets, prices) {
  const perMillion = 1_000_000;
  const cacheHit = (buckets.cacheReadTokens * prices.cacheHit) / perMillion;
  const cacheMiss = (buckets.uncachedInputTokens * prices.cacheMiss) / perMillion;
  // 缓存写入没有独立价格：DeepSeek 只区分缓存命中/未命中，写入按未命中价。
  const cacheWrite = (buckets.cacheWriteTokens * prices.cacheMiss) / perMillion;
  const output = (buckets.outputTokens * prices.output) / perMillion;
  return {
    cacheHit,
    cacheMiss,
    cacheWrite,
    output,
    total: cacheHit + cacheMiss + cacheWrite + output,
  };
}

/**
 * 人民币金额的紧凑文本（不带 ¥，便于拼模板）。
 * 规则：≥10 元两位小数，≥1 元三位，≥0.01 元四位，更小的金额六位；
 * 末尾多余的 0 去掉，但至少保留两位小数；非有限值返回破折号。
 * @param value - 金额（元）。
 * @returns 金额文本。
 */
function formatYuan(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 10 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
  let text = value.toFixed(digits);
  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '');
    const dot = text.indexOf('.');
    const decimals = dot === -1 ? 0 : text.length - dot - 1;
    if (decimals < 2) text = text.includes('.') ? `${text}${'0'.repeat(2 - decimals)}` : `${text}.${'0'.repeat(2)}`;
  }
  return text;
}

/**
 * 千分位整数文本。
 * @param value - 数字。
 * @returns 形如 1,234,567 的文本。
 */
function formatInt(value) {
  if (!Number.isFinite(value)) return '—';
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 单价的紧凑文本（去掉多余的 0）。
 * @param value - 单价（元 / 百万 tokens）。
 * @returns 形如 0.04 / 2 / 13.5 的文本。
 */
function formatRate(value) {
  if (!Number.isFinite(value)) return '—';
  const text = value.toFixed(4).replace(/\.?0+$/, '');
  return text === '' || text === '-' ? '0' : text;
}

/**
 * 高峰窗口的展示文本。
 * @param window - `[起, 止)` 分钟数；为 null 时返回空串。
 * @returns 形如 09:00–12:00 的文本。
 */
function formatWindow(window) {
  if (window === null || window === undefined) return '';
  const clock = (minuteOfDay) => `${pad2(Math.floor(minuteOfDay / 60))}:${pad2(minuteOfDay % 60)}`;
  return `${clock(window[0])}–${clock(window[1])}`;
}

/**
 * 倒计时文本：超过 1 小时为 H:MM:SS，否则 M:SS。
 * @param ms - 毫秒。
 * @returns 倒计时文本。
 */
function formatCountdown(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${minutes}:${pad2(seconds)}`;
}

    /**
     * 输入框下方「计费（人民币）」读数，浏览器半边。
     *
     * 注册进 `conversation.composer.dock`（会话作用域的 list 槽位，即输入框卡片
     * 下方那一行：「N 轮 M 步 · tok/s」「X tok · 缓存命中 Y%」以及各连接器插件的
     * 积分读数）。本条目显示当前会话按 DeepSeek 官方人民币价目表估算的费用，
     * 并按北京时间的峰/谷时段自动切换单价；点开是分桶明细、当前时段、距切换
     * 倒计时与规则出处。
     *
     * 数据全部来自标准属性：`useProjection('tokenUsage')`（累计 token 桶）与
     * `useProjection('modelSelection')`（provider/model），不发起任何网络请求，
     * 也不接触任何密钥。
     */

    /** 本插件拥有的 locale 命名空间。 */
    var NS = "billing-meter";
    /** 输入框下方的环境条目槽位。 */
    var SLOT = "conversation.composer.dock";
    /** 条目键：新 id 追加在官方统计条目旁，不会顶掉别人的格子。 */
    var ENTRY_ID = "billing";
    /** 排序：官方 usage（1）之后、连接器积分读数（10）之前。 */
    var ENTRY_ORDER = 2;

    /** 文案。zh 为默认，en 跟随界面语言。 */
    var COPY = {
      zh: {
        "entry.label": "计费",
        "pill.aria": "本会话计费 ¥{amount}，当前{tier}时段",
        "tier.peak": "高峰",
        "tier.offpeak": "空闲",
        "panel.title": "会话计费（人民币）",
        "panel.estimate": "估算",
        "panel.period": "当前时段",
        "panel.period.peak": "高峰 {window}",
        "panel.period.offpeak": "空闲（高峰价的 50%）",
        "panel.switch": "距切换",
        "panel.switch.value": "{countdown} 后转{next}",
        "panel.switch.none": "—",
        "panel.model": "计费模型",
        "panel.cacheHit": "缓存命中输入",
        "panel.cacheMiss": "未命中输入",
        "panel.cacheWrite": "缓存写入",
        "panel.output": "输出",
        "panel.breakdown": "{tokens} tok × ¥{rate}/M = ¥{cost}",
        "panel.total": "合计（当前时段价）",
        "panel.peakTotal": "若全按高峰价",
        "panel.footer": "规则：北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰（中国法定节假日除外），其余时段为空闲；空闲价为高峰价的 50%。",
        "panel.source": "价格来源：{date} 核对 · ",
        "panel.reference": "当前模型非 DeepSeek 官方直连，金额按官方价目表参考估算。",
        "panel.uncertain": "该模型的官方计费口径存在矛盾（价格页与 2026-09-10 更新日志不一致），金额仅供参考。",
        "panel.calendar": "{year} 年节假日日历未收录，已按工作日估算。",
        "panel.unit": "元/百万 tokens",
      },
      en: {
        "entry.label": "Billing",
        "pill.aria": "This session costs ¥{amount} at the current {tier} rate",
        "tier.peak": "peak",
        "tier.offpeak": "off-peak",
        "panel.title": "Session billing (CNY)",
        "panel.estimate": "estimate",
        "panel.period": "Current period",
        "panel.period.peak": "Peak {window}",
        "panel.period.offpeak": "Off-peak (50% of peak)",
        "panel.switch": "Next switch",
        "panel.switch.value": "{countdown} to {next}",
        "panel.switch.none": "—",
        "panel.model": "Priced model",
        "panel.cacheHit": "Cache-hit input",
        "panel.cacheMiss": "Cache-miss input",
        "panel.cacheWrite": "Cache write",
        "panel.output": "Output",
        "panel.breakdown": "{tokens} tok × ¥{rate}/M = ¥{cost}",
        "panel.total": "Total (current period)",
        "panel.peakTotal": "All at peak price",
        "panel.footer": "Rule: Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00 are peak (excluding Chinese statutory holidays); all other times are off-peak at 50% of the peak price.",
        "panel.source": "Prices: checked {date} · ",
        "panel.reference": "This model is not served by the official DeepSeek API; the amount is a reference estimate at official prices.",
        "panel.uncertain": "Official billing for this model is contradictory (pricing page vs the 2026-09-10 changelog); the amount is only a reference.",
        "panel.calendar": "The holiday calendar does not cover {year}; weekday estimation applied.",
        "panel.unit": "CNY per million tokens",
      },
    };

    /**
     * 插件样式。
     *
     * 计费 pill 的字号/行高/颜色不是“差不多”，而是对齐同排官方统计 pill 的实测
     * 计算值（2026-10-19 DSH 0.1.5-rc.2 desktop：12px / 20px / font-weight 400 /
     * color: var(--dsw-alias-label-tertiary)）。官方 pill 的 12px 不来自
     * `--dsh-content-font-size-secondary`（该变量在本机算出 13px），所以这里直接
     * 写死 12px，保证与「N 轮 M 步」「X tok · 缓存命中 Y%」完全一致。
     */
    var CSS = [
      ".dsh-bill-anchor{min-width:0;display:inline-flex;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}",
      ".dsh-bill-pill{box-sizing:border-box;max-width:100%;color:inherit;font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Hiragino Sans GB\",\"Microsoft YaHei\",\"Helvetica Neue\",Helvetica,Arial,sans-serif);font-size:12px;font-weight:400;font-style:normal;line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap;background:0 0;border:none;border-radius:24px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}",
      ".dsh-bill-pill:hover,.dsh-bill-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".dsh-bill-amount{font-variant-numeric:tabular-nums}",
      ".dsh-bill-sep{color:var(--dsw-alias-separator-primary)}",
      ".dsh-bill-tier{color:inherit}",
      ".dsh-bill-panel{z-index:1100;box-sizing:border-box;position:fixed;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:16px;font-size:12px;line-height:18px;width:max-content;min-width:min(320px,100vw - 24px);max-width:min(440px,100vw - 24px)}",
      ".dsh-bill-title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}",
      ".dsh-bill-titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}",
      ".dsh-bill-glyph{display:inline-grid;place-items:center;flex:none;width:14px;height:14px;font-size:12px;font-weight:600;line-height:1}",
      ".dsh-bill-titleValue{font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".dsh-bill-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}",
      ".dsh-bill-details{color:var(--dsw-alias-label-tertiary);grid-template-columns:auto minmax(0,1fr);gap:6px 16px;margin:0;display:grid}",
      ".dsh-bill-details dt,.dsh-bill-details dd{min-width:0;margin:0}",
      ".dsh-bill-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}",
      ".dsh-bill-details dd.dsh-bill-total{color:var(--dsw-alias-label-primary);font-weight:500}",
      ".dsh-bill-foot{margin-top:10px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;max-width:360px}",
      ".dsh-bill-foot a{color:inherit;text-decoration:underline}",
      ".dsh-bill-note{color:var(--dsw-alias-state-warn-primary);margin-top:4px}",
    ].join("");

    /**
     * 安装本插件样式表（只装一次，随插件卸载移除）。
     * @returns 移除 style 元素的清理函数。
     */
    function installStyles() {
      var el = document.createElement("style");
      el.setAttribute("data-dsh-billing-meter", "");
      el.textContent = CSS;
      document.head.appendChild(el);
      return function disposeStyles() {
        if (el.parentNode !== null) el.parentNode.removeChild(el);
      };
    }

    /**
     * 一个按固定间隔刷新的「现在」时间戳，用来驱动峰/谷切换与倒计时。
     * @param intervalMs - 刷新间隔。
     * @returns 当前 epoch 毫秒。
     */
    function useNow(intervalMs) {
      var pair = React.useState(function () {
        return Date.now();
      });
      var now = pair[0];
      var setNow = pair[1];
      React.useEffect(
        function () {
          var timer = setInterval(function () {
            setNow(Date.now());
          }, intervalMs);
          return function () {
            clearInterval(timer);
          };
        },
        [intervalMs],
      );
      return now;
    }

    /**
     * 用当前会话投影渲染计费读数。
     * @param props - 槽位标准属性加上注入的 t。
     * @returns pill 与（展开时）portal 弹层；无法计价时不渲染。
     */
    function BillingPill(props) {
      var t = props.t;
      var useProjection = props.useProjection;
      var usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
      var selection = typeof useProjection === "function" ? useProjection("modelSelection") : undefined;

      var openPair = React.useState(false);
      var open = openPair[0];
      var setOpen = openPair[1];
      var now = useNow(open ? 1000 : 30000);

      var triggerRef = React.useRef(null);
      var panelRef = React.useRef(null);

      React.useEffect(
        function () {
          if (!open) return undefined;
          var onPointerDown = function (event) {
            var trigger = triggerRef.current;
            var panel = panelRef.current;
            if (trigger !== null && trigger.contains(event.target)) return;
            if (panel !== null && panel.contains(event.target)) return;
            setOpen(false);
          };
          var onKeyDown = function (event) {
            if (event.key === "Escape") setOpen(false);
          };
          document.addEventListener("pointerdown", onPointerDown, true);
          document.addEventListener("keydown", onKeyDown);
          return function () {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
          };
        },
        [open],
      );

      var buckets = usageOf(usage);
      var selected =
        selection !== null && selection !== undefined
          ? selection.next !== null && selection.next !== undefined
            ? selection.next
            : selection.lastUsed
          : undefined;
      var model = resolveModel(selected !== null && selected !== undefined ? selected.model : undefined);
      var tokenTotal =
        buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens;
      if (model === null || tokenTotal === 0) return null;

      var status = statusAt(now);
      var price = priceAt(model, status.period);
      var cost = costOf(buckets, price.effective);
      var peakCost = status.period === "peak" ? cost.total : costOf(buckets, model.peakPrice).total;
      var tier = status.period === "peak" ? t("tier.peak") : t("tier.offpeak");
      var nextTier = status.period === "peak" ? t("tier.offpeak") : t("tier.peak");
      var amountText = formatYuan(cost.total);
      var countdown =
        status.msUntilSwitch === null
          ? t("panel.switch.none")
          : t("panel.switch.value", { countdown: formatCountdown(status.msUntilSwitch), next: nextTier });
      var windowText = formatWindow(status.window);

      var pill = React.createElement(
        "button",
        {
          type: "button",
          ref: triggerRef,
          className: "dsh-bill-pill",
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          "aria-label": t("pill.aria", { amount: amountText, tier: tier }),
          onClick: function () {
            setOpen(!open);
          },
        },
        React.createElement("span", { className: "dsh-bill-amount" }, "¥" + amountText),
        React.createElement("span", { className: "dsh-bill-sep", "aria-hidden": true }, "·"),
        React.createElement("span", { className: "dsh-bill-tier" }, tier),
      );

      var panel = null;
      if (open) {
        var rect = triggerRef.current === null ? null : triggerRef.current.getBoundingClientRect();
        var panelStyle =
          rect === null
            ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
            : {
                left: Math.min(Math.max(rect.left + rect.width / 2, 12), Math.max(12, window.innerWidth - 12)),
                bottom: Math.max(12, window.innerHeight - rect.top + 8),
                transform: "translateX(-50%)",
              };

        var rows = [];
        rows.push([
          t("panel.period"),
          status.period === "peak" ? t("panel.period.peak", { window: windowText }) : t("panel.period.offpeak"),
        ]);
        rows.push([t("panel.switch"), countdown]);
        rows.push([
          t("panel.model"),
          model.label + (selected !== null && selected !== undefined ? " · " + selected.provider : ""),
        ]);
        var breakdown = function (tokens, rate, amount) {
          return t("panel.breakdown", {
            tokens: formatInt(tokens),
            rate: formatRate(rate),
            cost: formatYuan(amount),
          });
        };
        rows.push([
          t("panel.cacheHit"),
          breakdown(buckets.cacheReadTokens, price.effective.cacheHit, cost.cacheHit),
        ]);
        rows.push([
          t("panel.cacheMiss"),
          breakdown(
            buckets.uncachedInputTokens,
            price.effective.cacheMiss,
            cost.cacheMiss,
          ),
        ]);
        if (buckets.cacheWriteTokens > 0) {
          rows.push([
            t("panel.cacheWrite"),
            breakdown(buckets.cacheWriteTokens, price.effective.cacheMiss, cost.cacheWrite),
          ]);
        }
        rows.push([t("panel.output"), breakdown(buckets.outputTokens, price.effective.output, cost.output)]);
        rows.push([t("panel.total"), "¥" + formatYuan(cost.total), true]);
        if (status.period !== "peak") {
          rows.push([t("panel.peakTotal"), "¥" + formatYuan(peakCost)]);
        }

        var details = [];
        for (var index = 0; index < rows.length; index += 1) {
          var row = rows[index];
          details.push(React.createElement("dt", { key: "k" + index }, row[0]));
          details.push(
            React.createElement("dd", { key: "v" + index, className: row[2] ? "dsh-bill-total" : undefined }, row[1]),
          );
        }

        var foot = React.createElement(
          "div",
          { className: "dsh-bill-foot" },
          React.createElement("div", null, t("panel.footer")),
          React.createElement(
            "div",
            null,
            t("panel.source", { date: POLICY.verifiedAt }),
            " ",
            React.createElement(
              "a",
              { href: POLICY.source.url, target: "_blank", rel: "noreferrer noopener" },
              POLICY.source.label,
            ),
          ),
          selected !== null && selected !== undefined && selected.provider !== "deepseek-account"
            ? React.createElement("div", { className: "dsh-bill-note" }, t("panel.reference"))
            : null,
          model.pricingUncertain === true
            ? React.createElement("div", { className: "dsh-bill-note" }, t("panel.uncertain"))
            : null,
          status.calendarCovered
            ? null
            : React.createElement("div", { className: "dsh-bill-note" }, t("panel.calendar", { year: status.year })),
        );

        panel = ReactDOM.createPortal(
          React.createElement(
            "div",
            {
              ref: panelRef,
              className: "dsh-bill-panel",
              role: "dialog",
              "aria-label": t("panel.title"),
              style: panelStyle,
            },
            React.createElement(
              "div",
              { className: "dsh-bill-title" },
              React.createElement(
                "span",
                { className: "dsh-bill-titleLabel" },
                React.createElement("span", { className: "dsh-bill-glyph", "aria-hidden": true }, "¥"),
                t("panel.title"),
              ),
              React.createElement("span", { className: "dsh-bill-titleValue" }, "¥" + amountText),
            ),
            React.createElement("div", { className: "dsh-bill-rule", "aria-hidden": true }),
            React.createElement("dl", { className: "dsh-bill-details" }, details),
            foot,
          ),
          document.body,
        );
      }

      return React.createElement("span", { className: "dsh-bill-anchor" }, pill, panel);
    }

    /** Cordis 插件名。 */
    var name = "billing-meter";

    /** 浏览器半边依赖的服务。 */
    var inject = ["slots", "locale"];

    /**
     * 挂载计费读数。
     * @param ctx - 浏览器插件上下文。
     */
    function apply(ctx) {
      var t = ctx.locale.bind(NS);

      ctx.effect(installStyles, "billing-meter: styles");
      ctx.effect(
        function registerCopy() {
          return ctx.locale.register(NS, COPY);
        },
        "billing-meter: copy",
      );

      ctx.effect(
        function mountPill() {
          var dispose = ctx.slots.inject(SLOT, function register() {
            return ctx.slots.register(
              {
                name: SLOT,
                id: ENTRY_ID,
                order: ENTRY_ORDER,
                label: function label() {
                  return ctx.locale.bind(NS)("entry.label");
                },
                locale: NS,
                inject: function injected() {
                  return { t: ctx.locale.bind(NS) };
                },
              },
              BillingPill,
            );
          });
          return function disposePill() {
            if (typeof dispose === "function") dispose();
          };
        },
        "billing-meter: pill",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  },
});
