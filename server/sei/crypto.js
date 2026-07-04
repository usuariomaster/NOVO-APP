import crypto from 'node:crypto';

// Deriva uma chave de 32 bytes a partir do APP_SECRET para AES-256-GCM.
function chave() {
  const segredo = process.env.APP_SECRET || 'chave-padrao-insegura-troque-me';
  return crypto.createHash('sha256').update(segredo).digest();
}

// Criptografa texto (ex.: senha do SEI) -> string "iv:tag:dados" em base64.
export function criptografar(texto) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), dados.toString('base64')].join(':');
}

export function descriptografar(pacote) {
  const [ivB64, tagB64, dadosB64] = String(pacote).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dados = Buffer.concat([
    decipher.update(Buffer.from(dadosB64, 'base64')),
    decipher.final(),
  ]);
  return dados.toString('utf8');
}
