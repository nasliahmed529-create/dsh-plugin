import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 产物漂移守卫：`lib/client.js` 必须等于「模板 + 当前 policy 源码」的构建结果，
 * 且整体是一个语法合法的浏览器脚本。
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('lib/client.js 与 src 源保持同步', () => {
  const pkg = JSON.parse(read('package.json'));
  const policy = read('src/policy.js').trim();
  const template = read('src/client.template.js');
  const inlined = policy.replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm, '');
  const expected = template
    .replace('/*__PACKAGE_NAME__*/', JSON.stringify(pkg.name))
    .replace('/*__POLICY__*/', () => inlined);
  assert.equal(read('lib/client.js'), expected, 'run `node scripts/build-client.mjs`');
});

test('lib/client.js 是合法脚本且不含未替换的占位符', () => {
  const source = read('lib/client.js');
  assert.equal(source.includes('__POLICY__'), false);
  assert.equal(source.includes('__PACKAGE_NAME__'), false);
  assert.doesNotThrow(() => new Function(source));
  // 模块 id 必须是包名，否则浏览器模块表拿不到这个插件。
  const pkg = JSON.parse(read('package.json'));
  assert.ok(source.includes(`id: ${JSON.stringify(pkg.name)}`));
});

test('Host 半边与 bundle 元数据齐全', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.exports['./client'], './lib/client.js');
  assert.ok(read('cordis.patch.yml').includes(pkg.name));
  const host = read('lib/index.js');
  assert.ok(host.includes('export const name'));
  assert.ok(host.includes('export function apply'));
});
