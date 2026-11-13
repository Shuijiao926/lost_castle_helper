/** 将已审定的流派记录输出为可校验的 JSON。 */
'use strict';

const fs = require('node:fs/promises');
const { createContainer } = require('../apps/server/src/app/container');
const { importBuilds } = require('../apps/server/src/modules/builds/application/import-builds');

async function main() {
  const [sourceType, input, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error('用法：node scripts/import-builds.js <来源类型> <输入.json> <新输出.json>');
  const file = JSON.parse(await fs.readFile(input, 'utf8'));
  const { catalogRepository } = createContainer();
  const result = await importBuilds({ sourceType, file, catalogRepository });
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

main().catch((error) => {
  console.error(error.message);
  for (const detail of error.errors || []) console.error(`  ${detail}`);
  process.exitCode = 1;
});
