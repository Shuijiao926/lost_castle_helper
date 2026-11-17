'use strict';

/**
 * 主进程日志：统一前缀，便于和渲染层 / 原生 helper 日志区分。
 */
function log(...args) {
  console.log('[lc2]', ...args);
}
log.error = (...args) => console.error('[lc2]', ...args);
log.warn = (...args) => console.warn('[lc2]', ...args);
const debugEnabled = process.env.LC2_LOG_LEVEL === 'debug';
log.debug = (...args) => { if (debugEnabled) log(...args); };

module.exports = log;
