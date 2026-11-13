'use strict';

const { Build, BuildStatus, SourceType, LICENSE } = require('../domain/build');
const { ValidationError } = require('../../../shared/kernel/errors');
const { validateFile } = require('../../../shared/kernel/shared-kernel');

function hasSourceLink(source) {
  if (typeof source !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(source).protocol);
  } catch {
    return false;
  }
}

const handlers = new Map([
  [SourceType.SELF_TEST, (record) => record],
  [SourceType.MAINTAINER, (record) => record],
  [SourceType.PR, (record) => {
    if (!hasSourceLink(record?.source)) throw new ValidationError('PR 流派必须附来源链接');
    return record;
  }],
  [SourceType.AUTHORIZED_SUBMISSION, (entry) => {
    if (entry?.meta?.licenseAccepted !== true) throw new ValidationError('投稿必须有作者授权');
    const { author, source } = entry.meta;
    if (!hasSourceLink(source)) throw new ValidationError('投稿必须附来源链接');
    if (!entry.payload || typeof entry.payload !== 'object' || Array.isArray(entry.payload)) {
      throw new ValidationError('投稿必须包含流派记录');
    }
    return { ...entry.payload, author, source };
  }],
]);

/** 将已审定的人工记录转为现有流派文件格式，供维护者校验和合并。 */
async function importBuilds({ sourceType, file, catalogRepository }) {
  const prepare = handlers.get(sourceType);
  if (!prepare) throw new ValidationError(`不支持将 ${sourceType} 作为流派来源`);
  if (!Array.isArray(file?.builds) || !file.builds.length) throw new ValidationError('至少需要一条流派记录');
  for (const field of ['version', 'gameVersion']) {
    if (typeof file[field] !== 'string' || !file[field].trim()) throw new ValidationError(`必须填写 ${field}`);
  }

  const catalog = await catalogRepository.load();
  const builds = file.builds.map((entry) => {
    const record = prepare(entry);
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new ValidationError('流派必须是对象');
    if (record.license !== undefined && record.license !== LICENSE) throw new ValidationError(`license 只允许 ${LICENSE}`);
    if (record.status !== undefined && record.status !== BuildStatus.PUBLISHED) {
      throw new ValidationError('导入记录必须已审定');
    }
    const { status, ...payload } = record;
    const build = Build.fromRecord({ ...payload, sourceType, license: LICENSE }, catalog, {
      strict: true,
      status: BuildStatus.PUBLISHED,
    });
    return build.toPackageItem();
  });

  const check = validateFile({ builds });
  if (!check.ok) throw new ValidationError(check.errors);
  return { version: file.version, gameVersion: file.gameVersion, builds };
}

module.exports = { importBuilds };
