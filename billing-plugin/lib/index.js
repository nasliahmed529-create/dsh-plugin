/**
 * dsh-billing-meter 的 Host 半边。
 *
 * 这里刻意什么都不做：计费读数完全在浏览器半边用标准投影
 * （`tokenUsage` / `modelSelection`）渲染，不需要 Host 服务、工具、会话状态
 * 或网络路由。Host 半边只负责让本 bundle 成为 loader 层栈里一个合法的
 * Cordis 插件条目，从而使浏览器半边随之加载。
 */

/** Cordis 插件名。 */
export const name = 'billing-meter';

/** 不依赖任何 Host 服务。 */
export const inject = [];

/** 无 Host 行为。 */
export function apply() {}
