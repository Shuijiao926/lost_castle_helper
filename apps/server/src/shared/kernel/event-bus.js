'use strict';

/**
 * 进程内领域事件总线
 *
 * 现在只需要这一个实现：投稿通过 → 标记需要重新打包。
 * 以后要换成消息队列，只需实现同样的 publish/subscribe 接口。
 */

class InMemoryEventBus {
  constructor({ logger = console } = {}) {
    this.handlers = new Map();
    this.logger = logger;
  }

  subscribe(eventName, handler) {
    if (!this.handlers.has(eventName)) this.handlers.set(eventName, []);
    this.handlers.get(eventName).push(handler);
    return () => {
      const list = this.handlers.get(eventName) || [];
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  publish(eventName, payload) {
    const list = this.handlers.get(eventName) || [];
    for (const handler of list) {
      try {
        handler(payload, eventName);
      } catch (e) {
        this.logger.warn?.(`[events] 处理 ${eventName} 失败: ${e.message}`);
      }
    }
  }

  /** 调试用：查看已注册的事件名 */
  eventNames() {
    return [...this.handlers.keys()];
  }
}

module.exports = { InMemoryEventBus };
