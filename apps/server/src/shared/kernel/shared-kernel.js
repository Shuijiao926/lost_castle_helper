'use strict';

/**
 * 共享内核（Shared Kernel）
 *
 * packages/shared 是客户端与服务端共用的校验规则（DDD 里的 Shared Kernel）：
 *   - 客户端投稿前预检
 *   - 服务端领域层最终把关
 *
 * 这是领域层**唯一**允许的外部依赖：纯函数、无 IO、无框架。
 * 优先按 workspace 包名解析（@lc2/shared），失败时回退到源码相对路径
 * （方便在没有 npm install 的环境里直接跑脚本）。
 */

function loadSharedKernel() {
  const tried = [];

  try {
    return require('@lc2/shared');
  } catch (e) {
    tried.push(`@lc2/shared: ${e.code || e.message}`);
  }

  // apps/server/src/shared/kernel -> shared -> src -> server -> apps
  const fallback = require('path').join(__dirname, '..', '..', '..', '..', 'shared', 'validate.js');
  try {
    return require(fallback);
  } catch (e) {
    tried.push(`${fallback}: ${e.code || e.message}`);
  }

  throw new Error(`无法加载共享内核 packages/shared：\n  ${tried.join('\n  ')}`);
}

module.exports = loadSharedKernel();
