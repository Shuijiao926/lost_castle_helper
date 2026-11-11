'use strict';

/**
 * 应用层：图鉴
 */

class GetCatalog {
  constructor({ catalogRepository }) {
    this.catalog = catalogRepository;
  }

  async execute() {
    const snapshot = await this.catalog.load();
    return snapshot.toDTO();
  }
}

module.exports = { GetCatalog };
