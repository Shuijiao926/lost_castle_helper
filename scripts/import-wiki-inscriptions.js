/** 获取法杖刻印事实并输出带署名的目录预览。 */
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { importInscriptions } = require('../apps/server/src/modules/catalog/application/import-inscriptions');
const { createHuijiWikiInscriptions } = require('../apps/server/src/modules/catalog/infrastructure/huiji-wiki-inscriptions');

async function main() {
  const [output, flag, input, ...extra] = process.argv.slice(2);
  if (!output || extra.length || ((flag || input) && (flag !== '--snapshot' || !input))) {
    throw new Error('用法：node scripts/import-wiki-inscriptions.js <新输出.json> [--snapshot <来源记录.json>]');
  }
  const file = JSON.parse(await fs.readFile(path.join(__dirname, '../data/inscriptions.json'), 'utf8'));
  const snapshot = input === undefined ? undefined : JSON.parse(await fs.readFile(input, 'utf8'));
  const source = createHuijiWikiInscriptions({ snapshot });
  const result = await importInscriptions({ source, file, weaponType: 'STAFF' });
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

main().catch((error) => {
  console.error(error.message);
  for (const detail of error.errors || []) console.error(`  ${detail}`);
  process.exitCode = 1;
});
