'use strict';

/**
 * 发布上下文（Publishing）
 *
 * 把「已发布的流派」打包成带版本的 DataPackage，供客户端拉取与增量更新。
 *
 * 领域服务 PackageAssembler 负责：
 *   1. 收集已发布流派
 *   2. 序列化（稳定排序，保证同内容同 hash）
 *   3. 计算 hash（hash 由基础设施注入，领域层不引 crypto）
 *   4. 版本号递增
 *
 * 领域层只依赖端口：Hasher / Clock / 仓储接口。
 */

const { ValidationError } = require('../../../shared/kernel/errors');

const VERSION_RE = /^(\d+\.\d+\.\d+(?:\.\d+)?)-r(\d+)$/;

class DataPackage {
  constructor({ version, gameVersion, fileUrl, fileHash, size, notes, publishedAt }) {
    this.version = version;
    this.gameVersion = gameVersion;
    this.fileUrl = fileUrl;
    this.fileHash = fileHash;
    this.size = size;
    this.notes = notes || '';
    this.publishedAt = publishedAt;
  }

  /** 下一个版本号：<gameVersion>-r<n+1> */
  static nextVersion(gameVersion, previous) {
    if (!gameVersion) throw new ValidationError(['缺少 gameVersion']);
    const prev = previous && VERSION_RE.exec(previous);
    const next = prev ? Number(prev[2]) + 1 : 1;
    return `${gameVersion}-r${next}`;
  }

  toDTO() {
    return {
      version: this.version,
      gameVersion: this.gameVersion,
      fileUrl: this.fileUrl,
      fileHash: this.fileHash,
      size: this.size,
      notes: this.notes,
      publishedAt: this.publishedAt,
    };
  }
}

/**
 * 稳定序列化：字段顺序固定、流派按 id 排序，
 * 保证「内容不变 → hash 不变」，客户端才不会白下载。
 */
function serializeBuilds(builds) {
  const normalized = builds
    .map((b) => b.toPackageItem())
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({ builds: normalized }, null, 2);
}

/**
 * 领域服务：组装数据包
 *
 * @param {{packageRepository, hasher:{sha256:(s)=>string}, clock:{now:()=>Date}}} deps
 * @param {{fileBaseUrl:string}} options
 */
class PackageAssembler {
  constructor(deps, options = {}) {
    this.packages = deps.packageRepository;
    this.hasher = deps.hasher;
    this.clock = deps.clock;
    this.fileBaseUrl = options.fileBaseUrl || '';
  }

  /**
   * @param {{builds:Build[], notes?:string, fileName?:string}} input
   * @returns {Promise<DataPackage>}
   */
  async assemble(input = {}) {
    const published = input.builds || [];
    if (!published.length) throw new ValidationError(['没有已发布的流派，拒绝生成空数据包']);

    const content = serializeBuilds(published);
    const hash = this.hasher.sha256(content);
    const previous = await this.packages.latest();
    const gameVersion = published[0].record.gameVersion || previous?.gameVersion || '0';
    const version = DataPackage.nextVersion(gameVersion, previous?.version);
    const fileName = input.fileName || `builds-${version}.json`;

    const pkg = new DataPackage({
      version,
      gameVersion,
      fileUrl: `${this.fileBaseUrl}/${fileName}`.replace(/([^:])\/\//g, '$1/'),
      fileHash: hash,
      size: Buffer.byteLength(content, 'utf8'),
      notes: input.notes || '',
      publishedAt: this.clock.now().toISOString(),
    });

    pkg.content = content; // 供仓储写出文件
    await this.packages.save(pkg);
    return pkg;
  }
}

class PackageRepository {
  async latest() {
    throw new Error('PackageRepository.latest() 未实现');
  }

  async save(pkg) {
    throw new Error('PackageRepository.save() 未实现');
  }
}

module.exports = { DataPackage, PackageAssembler, PackageRepository, serializeBuilds };
