// Assinatura digital de PDF com certificado ICP-Brasil A1 (.pfx/.p12).
// Gera o PDF a partir do HTML (via Chromium) e assina com o certificado.
import { PDFDocument } from 'pdf-lib';
import signpdfPkg from '@signpdf/signpdf';
import signerPkg from '@signpdf/signer-p12';
import phPkg from '@signpdf/placeholder-pdf-lib';
import { abrirNavegador } from '../sei/scraper.js';

const SignPdf = signpdfPkg.SignPdf || signpdfPkg.default;
const P12Signer = signerPkg.P12Signer || signerPkg.default;
const pdflibAddPlaceholder = phPkg.pdflibAddPlaceholder || phPkg.default;

// Renderiza um HTML em PDF (A4) usando o navegador do robô.
export async function htmlParaPdf(html) {
  const browser = await abrirNavegador();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return Buffer.from(await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
    }));
  } finally {
    await browser.close().catch(() => {});
  }
}

// Assina um PDF (buffer) com o certificado A1 (buffer .pfx) e a senha.
export async function assinarPdf(pdfBuffer, certBuffer, senha, meta = {}) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  pdflibAddPlaceholder({
    pdfDoc,
    reason: meta.motivo || 'Despacho pericial',
    contactInfo: meta.contato || '',
    name: meta.nome || 'Perito',
    location: meta.local || 'Nova Iguaçu/RJ',
  });
  const comPlaceholder = await pdfDoc.save();
  const signer = new P12Signer(certBuffer, { passphrase: senha || '' });
  return new SignPdf().sign(Buffer.from(comPlaceholder), signer);
}

// Conveniência: HTML -> PDF -> assinado.
export async function htmlParaPdfAssinado(html, certBuffer, senha, meta) {
  const pdf = await htmlParaPdf(html);
  return assinarPdf(pdf, certBuffer, senha, meta);
}
