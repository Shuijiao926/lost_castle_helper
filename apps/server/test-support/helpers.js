'use strict';

/** 测试辅助：读取仓库种子数据，构造图鉴快照 */

const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function readJSON(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
}

function makeCatalog() {
  const { CatalogSnapshot } = require('../src/modules/catalog/domain/catalog');
  const weapons = readJSON('data/weapons.json');
  const inscriptions = readJSON('data/inscriptions.json');
  const schools = readJSON('data/schools.json');
  return new CatalogSnapshot({
    version: weapons.version || '0',
    weapons: weapons.weapons,
    inscriptions: inscriptions.inscriptions,
    schools: schools.schools,
  });
}

function loadBuilds() {
  return readJSON('data/builds.json').builds;
}

module.exports = { REPO_ROOT, readJSON, makeCatalog, loadBuilds };
