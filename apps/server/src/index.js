/**
 * 服务启动入口
 *
 *   cp .env.example .env      # 可选，不配也能用文件模式跑
 *   npm install
 *   npm start
 */
const config = require('./config');

async function main() {
  let buildApp;
  try {
    ({ buildApp } = require('./app'));
  } catch (e) {
    console.error('[lc2-server] 依赖未安装，请先执行 npm install');
    console.error('   ', e.message);
    process.exit(1);
  }

  const app = await buildApp();

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (e) {
    console.error('[lc2-server] 启动失败：', e.message);
    process.exit(1);
  }

  const base = `http://${config.host}:${config.port}`;
  console.log(`[lc2-server] listening ${base}`);
  console.log(`[lc2-server] 存储模式：${config.databaseUrl ? 'PostgreSQL' : 'JSON 文件（无数据库）'}`);
  console.log(`[lc2-server] 文件存储：${config.fileStorage}`);

  const shutdown = async () => {
    await app.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
