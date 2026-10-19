/**
 * 生成浏览器产物 `lib/client.js`：把 `src/policy.js` 内联进
 * `src/client.template.js`（`scripts/build-client.mjs` 只去掉行首 `export`），
 * 并写入 package.json 的包名。
 *
 * 用法：
 *   node scripts/build-client.mjs          # 重新生成 lib/client.js
 *   node scripts/build-client.mjs --check  # 只校验产物是否与源码一致（CI/测试用）
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const policySource = readFileSync(join(root, 'src', 'policy.js'), 'utf8').trim();
const template = readFileSync(join(root, 'src', 'client.template.js'), 'utf8');

/** 去掉 `export ` 前缀，让策略源码可以直接落在 browser factory 作用域里。 */
const inlinedPolicy = policySource.replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm, '');

/** 期望的产物内容。 */
export function buildClientSource() {
  return template
    .replace('/*__PACKAGE_NAME__*/', JSON.stringify(packageJson.name))
    .replace('/*__POLICY__*/', () => inlinedPolicy);
}

const target = join(root, 'lib', 'client.js');
const expected = buildClientSource();

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== expected) {
    console.error('lib/client.js is stale: run `node scripts/build-client.mjs`');
    process.exit(1);
  }
  console.log('lib/client.js is up to date');
} else {
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(target, expected);
  console.log(`built lib/client.js (${Buffer.byteLength(expected)} bytes)`);
}
