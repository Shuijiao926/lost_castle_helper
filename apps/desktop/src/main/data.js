/**
 * 数据加载（应用层）
 *
 * 把 source 层（server / local / cache）的细节包住，
 * 对 IPC 只暴露结构化的客户端数据。
 *
 * 图鉴与流派并行拉取：两者走不同端点（/api/catalog 与 /data/builds.json），
 * 串行会让面板首次打开多等一个网络往返。
 */
function createDataLoader({ source, configStore, submissionStore }) {
  async function load() {
    const [loaded, statics] = await Promise.all([
      source.loadBuilds({ source: configStore.state.dataSource }),
      source.loadStatic(),
    ]);
    const file = loaded.file || { builds: [] };

    const builds = Array.isArray(file.builds) ? file.builds.slice() : [];
    if (submissionStore) {
      const drafts = submissionStore.list();
      const seen = new Set(builds.map((b) => b && b.id));
      drafts.forEach((d) => { if (!seen.has(d.id)) { builds.push(d); seen.add(d.id); } });
    }

    return {
      builds,
      weapons: statics.weapons,
      weaponItems: statics.weaponItems || [],
      armors: statics.armors || [],
      soulStones: statics.soulStones || [],
      cursedTreasures: statics.cursedTreasures || [],
      nightmareEffects: statics.nightmareEffects || [],
      inscriptions: statics.inscriptions,
      schools: statics.schools,
      treasures: statics.treasures || [],
      meta: {
        version: file.version || '0',
        gameVersion: file.gameVersion || '—',
        source: loaded.source, // server | github | cache | local
        dataSource: configStore.state.dataSource,
      },
    };
  }

  return { load };
}

module.exports = createDataLoader;
