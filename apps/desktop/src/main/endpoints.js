'use strict';

/**
 * 服务端地址的唯一来源。
 *
 * 桌面端所有对外请求（图鉴接口、流派数据包、投稿）都从这里取 base，
 * 不再各自读 process.env —— 否则默认值会散成好几处，改一个忘一个。
 *
 * LC2_API_URL 只用于联调（指向本机或另一台服务器）；正式安装包不带这个变量，
 * 走 DEFAULT_API_BASE。
 */

const DEFAULT_API_BASE = 'https://castle-helper.fun';

/** 去掉结尾斜杠，避免拼出 `//api/catalog` 这种地址。 */
function apiBase(env) {
  const raw = (env || process.env).LC2_API_URL;
  const value = raw && String(raw).trim() ? String(raw).trim() : DEFAULT_API_BASE;
  return value.replace(/\/+$/, '');
}

module.exports = { DEFAULT_API_BASE, apiBase };
