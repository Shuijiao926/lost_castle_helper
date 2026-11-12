/**
 * 数据加载（应用层）
 *
 * 把 source 层（github / local / cache）的细节包住，
 * 对 IPC 只暴露结构化的客户端数据。
 */
function createDataLoader({ source, configStore, log }) {
  async function load() {
    const loaded = await source.loadBuilds({ source: configStore.state.dataSource });
    const file = loaded.file || { builds: [] };
    const statics = source.loadStatic();

    const builds = Array.isArray(file.builds) ? file.builds : [];
    if (!builds.length) log('builds 数据为空（source=' + loaded.source + '）');

    return {
      builds,
      weapons: statics.weapons,
      inscriptions: statics.inscriptions,
      schools: statics.schools,
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
