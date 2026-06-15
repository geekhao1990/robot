// server/src/router.js
// 极简路由（零依赖）。支持 :param 路径参数。

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) =>
    routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });

  function match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    for (const r of routes) {
      if (r.method !== method) continue;
      if (r.parts.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }

  return {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
    match,
  };
}

module.exports = { createRouter, HttpError };
