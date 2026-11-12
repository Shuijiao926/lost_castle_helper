/**
 * 简单防抖（带 cancel），用于热部署、配置落盘等高频回调。
 */
module.exports = function debounce(fn, ms) {
  let timer = null;
  function wrapped(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  wrapped.pending = () => timer !== null;
  return wrapped;
};
