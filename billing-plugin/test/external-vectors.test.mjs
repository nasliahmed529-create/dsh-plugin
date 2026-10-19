import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { costOf, periodAt, priceAt, resolveModel, usageOf } from '../src/policy.js';

/**
 * 外部测试向量：由独立核验员（pricing-verification/expected-costs.json）
 * 依据官方价格页产出，用来交叉验证本插件的时段判定与费用公式。
 * 文件不存在时跳过，便于插件单独分发。
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vectorsPath = join(root, '..', 'pricing-verification', 'expected-costs.json');

test('官方核验员的期望费用向量', { skip: !existsSync(vectorsPath) && 'pricing-verification/expected-costs.json 不存在' }, () => {
  const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));
  assert.ok(Array.isArray(vectors) && vectors.length >= 8, '至少 8 组测试向量');
  for (const vector of vectors) {
    const instant = Date.parse(vector.atBeijing);
    assert.ok(Number.isFinite(instant), `${vector.id}: 时间无法解析`);
    const model = resolveModel(vector.model);
    assert.ok(model !== null, `${vector.id}: 模型无法映射到价目表: ${vector.model}`);
    assert.equal(periodAt(instant), vector.expectedPeriod, `${vector.id}: 时段不一致`);
    const cost = costOf(usageOf(vector.totals), priceAt(model, vector.expectedPeriod).effective).total;
    assert.ok(
      Math.abs(cost - vector.expectedCostYuan) <= 1e-6,
      `${vector.id}: 费用 ${cost} != 期望 ${vector.expectedCostYuan}`,
    );
  }
});
