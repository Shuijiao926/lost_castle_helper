'use strict';

/**
 * 通用日志组件
 *
 * 服务端统一从这里输出日志，业务代码不直接使用 console。
 * 输出格式：`<时间> <级别> [<scope>] <消息> {附加字段}`
 *
 * 级别：debug < info < warn < error，由 LOG_LEVEL 控制，默认 info。
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function trimFields(fields) {
  if (!fields || typeof fields !== 'object') return '';
  const pairs = Object.entries(fields).map(([k, v]) => {
    if (v === null || v === undefined) return `${k}=null`;
    if (typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
    return `${k}=${v}`;
  });
  return pairs.length ? ` ${pairs.join(' ')}` : '';
}

function createLogger({ scope = 'lc2', level = 'info' } = {}) {
  const threshold = LEVELS[String(level).toLowerCase()] ?? LEVELS.info;

  function write(lv, message, fields) {
    if (LEVELS[lv] < threshold) return;
    const time = new Date().toISOString();
    const line = `${time} ${lv.toUpperCase().padEnd(5)} [${scope}] ${message}${trimFields(fields)}`;
    if (lv === 'error') console.error(line);
    else if (lv === 'warn') console.warn(line);
    else console.log(line);
  }

  const logger = {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    /** 派生带 scope 的子日志器 */
    child(childScope) {
      return createLogger({ scope: `${scope}:${childScope}`, level });
    },
  };

  return logger;
}

module.exports = { createLogger, LEVELS };
