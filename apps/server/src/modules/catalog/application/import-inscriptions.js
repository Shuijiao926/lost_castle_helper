'use strict';

const { ValidationError } = require('../../../shared/kernel/errors');

/** 按已有刻印 ID 更新出处，保留其他武器的记录和目录元数据。 */
async function importInscriptions({ source, file, weaponType }) {
  const entries = file?.inscriptions;
  if (!Array.isArray(entries)) throw new ValidationError('刻印目录必须包含 inscriptions 数组');
  const known = entries.filter((item) => item.wt === weaponType);
  if (!known.length) throw new ValidationError(`武器类型未登记：${weaponType}`);

  const facts = await source.load({ weaponType });
  const names = new Set(facts.names);
  if (known.some((item) => !names.has(item.name)) || names.size !== known.length || names.size !== facts.names.length) {
    throw new ValidationError('来源中的刻印名称与当前武器目录不一致，请核对差异后导入');
  }

  return {
    ...file,
    inscriptions: entries.map((item) => item.wt === weaponType ? { ...item, source: facts.source } : item),
  };
}

module.exports = { importInscriptions };
