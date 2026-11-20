'use strict';

/**
 * 投稿提交（主进程应用层）
 *
 * 配了服务地址就优先让 Node 受理；只有「连不上 / 超时 / 5xx」才退回本地草稿。
 * 4xx 是内容问题（校验失败、限流、流派已存在），必须原样报给用户——
 * 静默转成本地草稿会让人以为提交成功了，实际后台什么都没收到。
 */

const DEFAULT_TIMEOUT = 8000;

function retryable(message) {
  return Object.assign(new Error(message), { retryable: true });
}

function createSubmitService({
  store,
  apiBase = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT,
  log,
} = {}) {
  if (!store) throw new Error('投稿提交需要本地草稿存储');
  const base = String(apiBase || '').replace(/\/+$/, '');

  /** 提交一条投稿，返回 mode 让渲染层决定提示文案。 */
  async function submit(payload, meta = {}) {
    if (!base) return saveLocal(payload, '未配置服务地址');
    try {
      const result = await post(payload, meta);
      return { ok: true, mode: 'remote', id: result.id, status: result.status };
    } catch (error) {
      if (!error.retryable) throw error;
      log?.('提交远端失败，转本地草稿:', error.message);
      return saveLocal(payload, error.message);
    }
  }

  /** 只发 payload + 授权声明；受理编号由服务端生成，客户端不参与。 */
  async function post(payload, meta) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(base + '/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payload,
          meta: {
            author: payload.author,
            licenseAccepted: true,
            sourceType: 'authorized-submission',
            ...meta,
          },
        }),
        signal: controller.signal,
      });
    } catch {
      // 断网、连接被拒、超时都归为「服务暂时不可用」，可以降级。
      throw retryable('连接服务失败');
    } finally {
      clearTimeout(timer);
    }
    const body = await readJson(response);
    if (!response.ok) {
      const message = (body && body.error) || `服务返回 ${response.status}`;
      if (response.status >= 500) throw retryable(message);
      throw new Error(message);
    }
    return body || {};
  }

  /** 离线或服务不可用时保留草稿，下次启动仍能在列表里看到。 */
  function saveLocal(payload, reason) {
    const saved = store.save(payload);
    return { ok: true, mode: 'local', path: saved.path, name: saved.name, reason };
  }

  return { submit, configured: Boolean(base) };
}

/** 错误响应可能不是 JSON（反代或网关），解析失败不掩盖原始状态码。 */
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

module.exports = createSubmitService;
