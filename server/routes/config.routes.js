// Configurações gerais da Perícia (editáveis): texto-padrão do comprovante,
// contato (WhatsApp, e-mail) e horários — usados nos documentos oficiais.
import { Router } from 'express';
import { getConfig, setConfig } from '../db.js';
import { exigirLogin, exigirPapel } from '../auth.js';
import { OBS_PADRAO_DEFAULT } from '../services/documentosPericia.js';

const router = Router();
router.use(exigirLogin);

router.get('/pericia', (req, res) => {
  res.json({
    comprovante_obs: getConfig('comprovante_obs') || OBS_PADRAO_DEFAULT.join('\n'),
    pericia_whatsapp: getConfig('pericia_whatsapp') || '(21) 96649-5532',
    pericia_email: getConfig('pericia_email') || 'periciamedica@novaiguacu.rj.gov.br',
    pericia_horario: getConfig('pericia_horario') || '08h às 12h (peritos) · 08h às 17h (administrativo, com agendamento)',
    // Só informa se o token da Natasha já está configurado (não devolve o valor).
    natasha_token_definido: !!(process.env.NATASHA_TOKEN || getConfig('natasha_token')),
    natasha_travado_env: !!process.env.NATASHA_TOKEN,
  });
});

router.post('/pericia', exigirPapel('admin', 'admin_master'), (req, res) => {
  const b = req.body || {};
  for (const k of ['comprovante_obs', 'pericia_whatsapp', 'pericia_email', 'pericia_horario']) {
    if (b[k] !== undefined) setConfig(k, String(b[k]));
  }
  // Token da Natasha (só grava se veio preenchido).
  if (b.natasha_token) setConfig('natasha_token', String(b.natasha_token).trim());
  res.json({ ok: true });
});

export default router;
