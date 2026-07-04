// Cliente HTTP simples para a API do SisPerícia.
async function req(metodo, url, corpo) {
  const opts = { method: metodo, headers: {} };
  if (corpo !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(corpo);
  }
  const resp = await fetch(url, opts);
  let dados = null;
  try { dados = await resp.json(); } catch { /* sem corpo */ }
  if (!resp.ok) {
    const msg = dados?.erro || `Erro ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.dados = dados;
    throw err;
  }
  return dados;
}

export const api = {
  get: (url) => req('GET', url),
  post: (url, corpo) => req('POST', url, corpo ?? {}),
  put: (url, corpo) => req('PUT', url, corpo ?? {}),
  del: (url) => req('DELETE', url),
};
