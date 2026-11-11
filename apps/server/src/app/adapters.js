'use strict';

/**
 * 技术适配器：哈希与时钟
 *
 * 领域层通过端口使用它们（PackageAssembler 需要 hash 与 now），
 * 这样领域层不直接依赖 node:crypto / Date。
 */

const crypto = require('crypto');

class NodeHasher {
  sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  }
}

class SystemClock {
  now() {
    return new Date();
  }

  today() {
    return new Date().toISOString().slice(0, 10);
  }
}

module.exports = { NodeHasher, SystemClock };
