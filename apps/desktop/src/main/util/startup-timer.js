'use strict';

const { performance } = require('node:perf_hooks');

function createStartupTimer(log, startedAt) {
  return function startStage(label, start = performance.now()) {
    return function finishStage(detail = '') {
      const end = performance.now();
      const duration = Math.round(end - start) + ' ms';
      const elapsed = start === startedAt ? '' : ' (累计 ' + Math.round(end - startedAt) + ' ms)';
      log('[启动]', label + ':', duration + elapsed + (detail ? ' · ' + detail : ''));
    };
  };
}

module.exports = createStartupTimer;
