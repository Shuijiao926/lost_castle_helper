/**
 * 数据加载（应用层）
 *
 * 把 source 层（github / local / cache）的细节包住，
 * 对 IPC 只暴露结构化的客户端数据。
 */
function createDataLoader({ source, configStore, log, submissionStore }) {
  async function load() {
    const loaded = await source.loadBuilds({ source: configStore.state.dataSource });
    const file = loaded.file || { builds: [] };
    const statics = source.loadStatic();

    const builds = Array.isArray(file.builds) ? file.builds.slice() : [];
    if (submissionStore) {
      const drafts = submissionStore.list();
      const seen = new Set(builds.map((b) => b && b.id));
      drafts.forEach((d) => { if (!seen.has(d.id)) { builds.push(d); seen.add(d.id); } });
      if (drafts.length) log('本地投稿草稿已合并:', drafts.length);
    }
    if (!builds.length) log('builds 数据为空（source=' + loaded.source + '）');

    return {
      builds,
      weapons: statics.weapons,
      weaponItems: statics.weaponItems || [],
      armors: statics.armors || [],
      soulStones: statics.soulStones || [],
      cursedTreasures: statics.cursedTreasures || [],
      inscriptions: statics.inscriptions,
      schools: statics.schools,
      treasures: statics.treasures || [],
      meta: {
        version: file.version || '0',
        gameVersion: file.gameVersion || '—',
        source: loaded.source, // local | github | cache
        dataSource: configStore.state.dataSource,
      },
    };
  }

  return { load };
}

module.exports = createDataLoader;
