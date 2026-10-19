import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLICY,
  costOf,
  formatCountdown,
  formatInt,
  formatRate,
  formatWindow,
  formatYuan,
  isPeak,
  nextSwitchAt,
  periodAt,
  priceAt,
  resolveModel,
  statusAt,
  usageOf,
} from '../src/policy.js';

/** 北京时间 ISO 文本 → epoch 毫秒。 */
const at = (iso) => Date.parse(iso);
/** 近似断言（费用为浮点）。 */
const near = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

const flash = POLICY.models.find((model) => model.id === 'deepseek-flash');
const pro = POLICY.models.find((model) => model.id === 'deepseek-v4-pro');

test('价目表：高峰价与空闲价（官方 2026-10 价目）', () => {
  assert.deepEqual(flash.peakPrice, { cacheHit: 0.04, cacheMiss: 2, output: 8 });
  assert.deepEqual(pro.peakPrice, { cacheHit: 0.3, cacheMiss: 9, output: 27 });
  assert.deepEqual(priceAt(flash, 'peak').effective, { cacheHit: 0.04, cacheMiss: 2, output: 8 });
  assert.deepEqual(priceAt(flash, 'off-peak').effective, { cacheHit: 0.02, cacheMiss: 1, output: 4 });
  assert.deepEqual(priceAt(pro, 'off-peak').effective, { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 });
  assert.equal(priceAt(flash, 'peak').discounted, false);
  assert.equal(priceAt(flash, 'off-peak').discounted, true);
});

test('峰/谷边界：半开区间 [09:00,12:00) 与 [14:00,18:00)', () => {
  assert.equal(periodAt(at('2026-10-19T08:59:59+08:00')), 'off-peak');
  assert.equal(periodAt(at('2026-10-19T09:00:00+08:00')), 'peak');
  assert.equal(periodAt(at('2026-10-19T09:00:01+08:00')), 'peak');
  assert.equal(periodAt(at('2026-10-19T11:59:59+08:00')), 'peak');
  assert.equal(periodAt(at('2026-10-19T12:00:00+08:00')), 'off-peak');
  assert.equal(periodAt(at('2026-10-19T13:59:59+08:00')), 'off-peak');
  assert.equal(periodAt(at('2026-10-19T14:00:00+08:00')), 'peak');
  assert.equal(periodAt(at('2026-10-19T17:59:59+08:00')), 'peak');
  assert.equal(periodAt(at('2026-10-19T18:00:00+08:00')), 'off-peak');
  assert.equal(periodAt(at('2026-10-19T23:00:00+08:00')), 'off-peak');
});

test('峰/谷：周末与 2026 法定节假日全天空闲', () => {
  // 2026-10-17 周六、2026-10-18 周日
  assert.equal(isPeak(at('2026-10-17T10:00:00+08:00')), false);
  assert.equal(isPeak(at('2026-10-18T15:00:00+08:00')), false);
  // 国庆：2026-10-01（周四）… 10-07（周三）
  assert.equal(isPeak(at('2026-10-01T10:00:00+08:00')), false);
  assert.equal(isPeak(at('2026-10-05T15:00:00+08:00')), false);
  assert.equal(isPeak(at('2026-10-07T10:00:00+08:00')), false);
  // 节后工作日恢复高峰
  assert.equal(isPeak(at('2026-10-08T10:00:00+08:00')), true);
  // 春节：2026-02-23（周一）假期
  assert.equal(isPeak(at('2026-02-23T10:00:00+08:00')), false);
  // 清明：2026-04-06（周一）
  assert.equal(isPeak(at('2026-04-06T15:00:00+08:00')), false);
  // 端午：2026-06-19（周五）
  assert.equal(isPeak(at('2026-06-19T10:00:00+08:00')), false);
  // 中秋：2026-09-25（周五）
  assert.equal(isPeak(at('2026-09-25T10:00:00+08:00')), false);
  // 普通周五白天是高峰
  assert.equal(isPeak(at('2026-10-16T10:00:00+08:00')), true);
});

test('nextSwitchAt：午休、下班、跨周末', () => {
  assert.equal(nextSwitchAt(at('2026-10-19T09:57:00+08:00')), at('2026-10-19T12:00:00+08:00'));
  assert.equal(nextSwitchAt(at('2026-10-19T12:00:00+08:00')), at('2026-10-19T14:00:00+08:00'));
  assert.equal(nextSwitchAt(at('2026-10-19T18:00:00+08:00')), at('2026-10-20T09:00:00+08:00'));
  // 2026-10-23 是周五：18:00 之后下一次高峰是周一 09:00。
  assert.equal(nextSwitchAt(at('2026-10-23T18:00:00+08:00')), at('2026-10-26T09:00:00+08:00'));
  // 周六白天：下一次高峰是周一 09:00。
  assert.equal(nextSwitchAt(at('2026-10-17T10:00:00+08:00')), at('2026-10-19T09:00:00+08:00'));
  // 国庆期间：下一次高峰仍是工作日 09:00。
  assert.equal(nextSwitchAt(at('2026-10-03T10:00:00+08:00')), at('2026-10-08T09:00:00+08:00'));
  // 倒计时与状态一致。
  const status = statusAt(at('2026-10-19T09:57:00+08:00'));
  assert.equal(status.period, 'peak');
  assert.equal(status.msUntilSwitch, 123 * 60 * 1000);
  assert.equal(status.calendarCovered, true);
  assert.deepEqual(status.window, [9 * 60, 12 * 60]);
  assert.equal(formatWindow(status.window), '09:00–12:00');
});

test('resolveModel：官方 id 与各家展示名映射', () => {
  assert.equal(resolveModel('deepseek-flash'), flash);
  assert.equal(resolveModel('DeepSeek-V4.1-Flash'), flash);
  assert.equal(resolveModel('DeepSeek-V4-Flash-Official'), flash);
  assert.equal(resolveModel('deepseek-v4.1-flash'), flash);
  assert.equal(resolveModel('DeepSeek-Flash'), flash);
  assert.equal(resolveModel('deepseek-v4-pro'), pro);
  assert.equal(resolveModel('DeepSeek-V4-Pro-Official'), pro);
  assert.equal(resolveModel('glm-5.3'), null);
  assert.equal(resolveModel('kimi-k2.6'), null);
  assert.equal(resolveModel('deepseek-chat'), null);
  assert.equal(resolveModel(''), null);
  assert.equal(resolveModel(undefined), null);
});

test('usageOf 兼容 wire 扁平视图与投影 state', () => {
  const flat = {
    uncachedInputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 40,
  };
  assert.deepEqual(usageOf(flat), flat);
  assert.deepEqual(usageOf({ totals: flat }), flat);
  assert.deepEqual(usageOf({ totals: flat, last: { turn: 1, step: 2, buckets: {} } }), flat);
  assert.deepEqual(usageOf({ last: { turn: 1, step: 2, buckets: flat } }), flat);
  assert.deepEqual(usageOf(undefined), {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
});

test('费用计算：分桶相加，缓存写入按未命中价', () => {
  const buckets = {
    uncachedInputTokens: 101888,
    outputTokens: 20356,
    cacheReadTokens: 2070272,
    cacheWriteTokens: 0,
  };
  const peak = costOf(buckets, priceAt(flash, 'peak').effective);
  near(peak.cacheHit, 0.08281088);
  near(peak.cacheMiss, 0.203776);
  near(peak.output, 0.162848);
  near(peak.total, 0.44943488);

  const offPeak = costOf(buckets, priceAt(flash, 'off-peak').effective);
  near(offPeak.total, 0.22471744);

  // 缓存写入按未命中价：100 万 cacheWrite → ¥2（高峰价）。
  const write = costOf({ uncachedInputTokens: 0, cacheReadTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 }, flash.peakPrice);
  near(write.cacheWrite, 2);
  near(write.total, 2);

  // 空用量是 0 元。
  near(costOf(usageOf(null), flash.peakPrice).total, 0);
});

test('金额与计数格式化', () => {
  assert.equal(formatYuan(0.44943488), '0.4494');
  assert.equal(formatYuan(0.02), '0.02');
  assert.equal(formatYuan(13.5), '13.50');
  assert.equal(formatYuan(0.00001), '0.00001');
  assert.equal(formatYuan(Number.NaN), '—');
  assert.equal(formatInt(1234567), '1,234,567');
  assert.equal(formatInt(0), '0');
  assert.equal(formatRate(0.04), '0.04');
  assert.equal(formatRate(2), '2');
  assert.equal(formatRate(13.5), '13.5');
  assert.equal(formatRate(0.3), '0.3');
  assert.equal(formatWindow([9 * 60, 12 * 60]), '09:00–12:00');
  assert.equal(formatWindow([14 * 60, 18 * 60]), '14:00–18:00');
  assert.equal(formatWindow(null), '');
  assert.equal(formatCountdown(2 * 3600_000 + 3 * 60_000 + 4_000), '2:03:04');
  assert.equal(formatCountdown(65_000), '1:05');
  assert.equal(formatCountdown(null), '—');
});
