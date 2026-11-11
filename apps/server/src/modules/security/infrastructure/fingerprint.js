'use strict';

/**
 * 安全上下文基础设施：请求指纹
 *
 * 不再直接存 IP / UA（隐私），而是存哈希：
 *   fingerprint = sha256(ip + '|' + ua)[:32]
 *
 * 同一 IP+UA 稳定；换 IP 或换 UA 视为新指纹（评分防刷的基本盘）。
 */

class RequestFingerprint {
  constructor({ hasher }) {
    this.hasher = hasher;
  }

  of(request) {
    const ip = String(request.ip || request.socket?.remoteAddress || '').replace('::ffff:', '');
    const ua = String(request.headers?.['user-agent'] || '').slice(0, 120);
    return this.hasher.sha256(`${ip}|${ua}`).slice(0, 32);
  }
}

module.exports = { RequestFingerprint };
