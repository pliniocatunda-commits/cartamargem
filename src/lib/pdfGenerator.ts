import { jsPDF } from 'jspdf';
import { Bank, PaystubData, CalculationResult, Signatory } from '../types';
import { formatCurrency } from './utils';

/**
 * Converts a number to its written form in Portuguese (BRL).
 */
function numberToWords(n: number): string {
  const units = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const teens = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  if (n === 0) return 'zero reais';

  const integerPart = Math.floor(n);
  const decimalPart = Math.round((n - integerPart) * 100);

  function convertGroup(num: number): string {
    if (num === 0) return '';
    if (num === 100) return 'cem';
    
    let res = '';
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const u = num % 10;

    if (h > 0) res += hundreds[h];
    if (t > 0) {
      if (res !== '') res += ' e ';
      if (t === 1) {
        res += teens[u];
        return res;
      }
      res += tens[t];
    }
    if (u > 0) {
      if (res !== '') res += ' e ';
      res += units[u];
    }
    return res;
  }

  let result = '';
  
  const thousands = Math.floor(integerPart / 1000);
  const remainder = integerPart % 1000;

  if (thousands > 0) {
    if (thousands === 1) {
      result += 'mil';
    } else {
      result += convertGroup(thousands) + ' mil';
    }
    if (remainder > 0) {
      if (remainder < 100 || remainder % 100 === 0) result += ' e ';
      else result += ' ';
    }
  }

  if (remainder > 0 || integerPart === 0) {
    result += convertGroup(remainder);
  }

  result += integerPart === 1 ? ' real' : ' reais';

  if (decimalPart > 0) {
    result += ' e ' + convertGroup(decimalPart) + (decimalPart === 1 ? ' centavo' : ' centavos');
  }

  return result;
}

async function fetchLogo(url: string): Promise<Blob | null> {
  try {
    console.log(`[Logo] Fetching: ${url}`);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      console.error(`[Logo] Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      return null;
    }
    const blob = await response.blob();
    console.log(`[Logo] Fetched: ${blob.size} bytes, type: ${blob.type}`);
    return blob;
  } catch (err) {
    console.error(`[Logo] Error fetching ${url}:`, err);
    return null;
  }
}

async function decodeLogo(blob: Blob): Promise<{ data: string, width: number, height: number } | null> {
  const attemptDecode = async (targetBlob: Blob, label: string): Promise<{ data: string, width: number, height: number } | null> => {
    try {
      // Try modern createImageBitmap first (more robust for some formats)
      if (typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(targetBlob);
          console.log(`[Logo] ${label} decoded via createImageBitmap: ${bitmap.width}x${bitmap.height}`);
          
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            const data = canvas.toDataURL('image/png');
            const result = { data, width: bitmap.width, height: bitmap.height };
            bitmap.close();
            return result;
          }
        } catch (e) {
          console.warn(`[Logo] ${label} createImageBitmap failed, falling back to Image object`);
        }
      }

      // Fallback to traditional Image object
      return new Promise((resolve) => {
        const objectUrl = URL.createObjectURL(targetBlob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          console.log(`[Logo] ${label} decoded via Image: ${img.width}x${img.height}`);
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            resolve({ data: canvas.toDataURL('image/png'), width: img.width, height: img.height });
          } else resolve(null);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        };
        img.src = objectUrl;
      });
    } catch (err) {
      console.error(`[Logo] ${label} decode error:`, err);
      return null;
    }
  };

  // 1. Direct attempt
  let result = await attemptDecode(blob, 'Direct');
  if (result) return result;

  // 2. Smart Slice attempt
  console.log('[Logo] Direct decode failed, attempting Smart Slice...');
  const buffer = await blob.arrayBuffer();
  const view = new Uint8Array(buffer);
  for (let i = 0; i < view.length - 4; i++) {
    // JPEG Start: FF D8
    if (view[i] === 0xFF && view[i+1] === 0xD8) {
      const sliced = new Blob([buffer.slice(i)], { type: 'image/jpeg' });
      const res = await attemptDecode(sliced, 'Sliced-JPEG');
      if (res) return res;
    }
    // PNG Start: 89 50 4E 47
    if (view[i] === 0x89 && view[i+1] === 0x50 && view[i+2] === 0x4E && view[i+3] === 0x47) {
      const sliced = new Blob([buffer.slice(i)], { type: 'image/png' });
      const res = await attemptDecode(sliced, 'Sliced-PNG');
      if (res) return res;
    }
  }
  return null;
}

export async function generateLetterPDF(
  bank: Bank,
  data: PaystubData,
  result: CalculationResult,
  signatory: Signatory
) {
  console.log('Generating PDF for:', data.serverName);
  const doc = new jsPDF();
  console.log('jsPDF instance created');
  
  // CONFIGURAÇÃO DO LOGOTIPO: 
  const EXTERNAL_LOGO_URL = 'https://raw.githubusercontent.com/pliniocatunda-commits/cartamargem/main/public/logo-ipme.png';
  const LOCAL_LOGO_URL = '/logo-ipme.png';
  
  let logoData: string | null = null;
  
  try {
    // 1. Try local logo
    let logoBlob = await fetchLogo(`${window.location.origin}/logo-ipme.png`);
    let decoded = logoBlob ? await decodeLogo(logoBlob) : null;

    // 2. Fallback to external logo if local fails (fetch or decode)
    if (!decoded) {
      console.log('[Logo] Local logo failed (fetch or decode), trying external URL...');
      logoBlob = await fetchLogo(EXTERNAL_LOGO_URL);
      decoded = logoBlob ? await decodeLogo(logoBlob) : null;
    }

    if (decoded) {
      logoData = decoded.data;
      (doc as any)._logoWidth = decoded.width;
      (doc as any)._logoHeight = decoded.height;
    }
  } catch (e) {
    console.warn('Silent logo load failure:', e);
    logoData = null;
  }

  const date = new Date();
  const day = String(date.getDate()).padStart(2, '0');
  const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  const dateStr = `Eusébio-CE, ${day} de ${month} de ${year}.`;

  const margin35 = (data.grossValue - data.irrf - data.pension) * 0.35;
  const totalLoans = data.consignedLoans.reduce((acc, l) => acc + l.value, 0);
  const availableMargin = Math.max(0, margin35 - totalLoans);

  const drawHeader = (doc: jsPDF) => {
    if (logoData) {
      try {
        const originalWidth = (doc as any)._logoWidth || 60;
        const originalHeight = (doc as any)._logoHeight || 30;
        const ratio = originalWidth / originalHeight;
        
        const maxWidth = 80; // Increased from 60
        const maxHeight = 40; // Increased from 30
        
        let targetWidth = maxWidth;
        let targetHeight = targetWidth / ratio;
        
        if (targetHeight > maxHeight) {
          targetHeight = maxHeight;
          targetWidth = targetHeight * ratio;
        }
        
        const x = (210 - targetWidth) / 2;
        doc.addImage(logoData, 'PNG', x, 5, targetWidth, targetHeight, undefined, 'FAST');
        return; // Success
      } catch (e) {
        console.error('Error adding logo to PDF, using fallback:', e);
        // If it fails, we'll fall through to the fallback below
      }
    }
    
    // Fallback to improved simulation if image is not found or corrupt
    // Colorful figures (circles/heads)
    doc.setDrawColor(0);
    doc.setFillColor(0, 180, 0); // Green
    doc.circle(92, 13, 1.5, 'F');
    doc.setFillColor(255, 230, 0); // Yellow
    doc.circle(98, 10, 1.5, 'F');
    doc.setFillColor(0, 200, 220); // Cyan
    doc.circle(105, 10, 1.5, 'F');
    doc.setFillColor(0, 0, 120); // Dark Blue
    doc.circle(112, 13, 1.5, 'F');
    doc.setFillColor(230, 0, 0); // Red
    doc.circle(118, 17, 1.5, 'F');
    
    // Arches (bodies)
    doc.setLineWidth(0.8);
    doc.setDrawColor(0, 180, 0); doc.line(90, 18, 94, 15);
    doc.setDrawColor(255, 230, 0); doc.line(96, 15, 100, 12);
    doc.setDrawColor(0, 200, 220); doc.line(103, 12, 107, 15);
    doc.setDrawColor(0, 0, 120); doc.line(110, 15, 114, 18);
    
    doc.setFont('times', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(0, 40, 100); 
    doc.text('IPME', 105, 23, { align: 'center' });

    doc.setFontSize(9);
    doc.setTextColor(0, 40, 100);
    doc.setFont('times', 'italic');
    doc.text('INSTITUTO DE PREVIDÊNCIA', 105, 28, { align: 'center' });
    doc.text('DO MUNICÍPIO DE EUSÉBIO', 105, 32, { align: 'center' });
  };

  const drawFooter = (doc: jsPDF) => {
    doc.setFontSize(8);
    doc.setTextColor(0, 50, 150); // BLUE footer as requested
    doc.text('INSTITUTO DE PREVIDÊNCIA DOS SERVIDORES PÚBLICOS MUNICIPAIS DE EUSÉBIO', 105, 267, { align: 'center' });
    doc.text('AV. CORONEL CÍCERO SÁ, 498, CENTRO, CEP: 61760435', 105, 272, { align: 'center' });
    doc.text('CNPJ: 04.865.123/0001-46', 105, 277, { align: 'center' });
    doc.text('TEL: (85) 9.8159-6242 | 9.8150-7797 | 9.8159-7140', 105, 282, { align: 'center' });
  };

  // --- PAGE 1: COMUNICADO ---
  drawHeader(doc);
  
  doc.setFontSize(16);
  doc.setFont('times', 'bold');
  doc.setTextColor(0);
  doc.text('COMUNICADO', 105, 65, { align: 'center' });

  doc.setFontSize(11);
  doc.setFont('times', 'normal');
  doc.text(dateStr, 190, 80, { align: 'right' });

  doc.setFont('times', 'bold');
  doc.text('Assunto: Solicitação de Informação de relativos Empréstimos Consignados', 20, 100);
  
  doc.text(`Ao Ilmo.(a) Sr.(a) Gerente Desta Instituição Bancária (${getBankFullName(bank)})`, 20, 115);

  doc.setFont('times', 'normal');
  const comunicadoPart1 = `Cumprimentando-o(a) cordialmente, venho através deste, SOLICITAR que, caso sejam concretizadas renovação, renegociação ou reparcelamento de empréstimos consignados por meio da Carta-Margem a que este comunicado se anexa, seja informado de imediato ao Instituto de Previdência do Município de Eusébio - IPME, pelo endereço de e-mail que segue: mikaely.vieira@ipmeusebio.ce.gov.br`;
  
  const comunicadoPart2 = `A motivação dessa solicitação se dá em virtude de manter o controle necessário para emissão de Cartas-Margens aos segurados, uma vez que as consignações ainda são manuais e de que tal conduta permite uma melhor aplicação da lei pertinente. Visando evitar qualquer eventualidade, reforçamos a cooperação da Instituição Bancária em favor deste Instituto de Previdência.`;

  // Render paragraphs separately to avoid justification issues with newlines
  doc.text(comunicadoPart1, 20, 125, { align: 'justify', maxWidth: 170 });
  
  // Calculate height of first paragraph to position the second one
  const dims1 = doc.getTextDimensions(comunicadoPart1, { maxWidth: 170 });
  const nextY = 125 + dims1.h + 8; // 8 units for a clear blank line
  
  doc.text(comunicadoPart2, 20, nextY, { align: 'justify', maxWidth: 170 });

  const dims2 = doc.getTextDimensions(comunicadoPart2, { maxWidth: 170 });
  const finalY = nextY + dims2.h + 10;
  doc.text('No ensejo, renovo os votos de estima e consideração.', 20, finalY);

  const sigY = Math.max(210, finalY + 25);
  doc.setTextColor(0);
  doc.text('_________________________________________________', 105, sigY, { align: 'center' });
  doc.setFont('times', 'bold');
  doc.text(signatory.name, 105, sigY + 6, { align: 'center' });
  doc.setFont('times', 'normal');
  doc.text(`Matrícula ${signatory.registration}`, 105, sigY + 12, { align: 'center' });
  doc.setFont('times', 'bold');
  doc.text(signatory.position, 105, sigY + 18, { align: 'center' });

  drawFooter(doc);

  // --- PAGE 2: DECLARAÇÃO ---
  doc.addPage();
  drawHeader(doc);
  doc.setTextColor(0); // Reset to black after header

  // LGPD Box
  doc.setDrawColor(0);
  doc.rect(135, 40, 55, 25);
  doc.setFontSize(8);
  doc.setFont('times', 'normal');
  doc.text('Espécie: Dados Pessoais', 137, 45);
  doc.text('Grau de Sigilo: Médio', 137, 49);
  doc.text('Dispensado de Consentimento', 137, 53);
  doc.text('na forma do art. 26, IV da Lei nº', 137, 57);
  doc.text('13.709/2018.', 137, 61);

  doc.setFontSize(11);
  doc.setFont('times', 'bold');
  doc.text(`Ao ${getBankFullName(bank).toUpperCase()}.`, 20, 50);

  const refText = `Ref.: Solicitação de Declaração de Margem Consignável (Mês/Ano Ref: ${data.referencePeriod || '---'}) com o fim de contratação de empréstimo consignado.`;
  doc.text(refText, 20, 65, { maxWidth: 110 });

  doc.setFont('times', 'normal');
  doc.text('Senhor Gerente,', 20, 80);

  const introText = `O INSTITUTO DE PREVIDÊNCIA DO MUNICÍPIO DE EUSÉBIO, CNPJ nº 04.865.123/0001-46, vem por meio desta informar os dados abaixo para fins de concessão de empréstimo consignado em folha de pagamentos.`;
  doc.text(introText, 20, 85, { align: 'justify', maxWidth: 170 });

  let y = 100; // Reverted from 85/90
  const bondName = data.bondType === '05' ? 'PENSIONISTA' : 'APOSENTADO(A)';
  const bondLabel = data.bondType === '05' ? 'PENSIONISTA' : 'APOSENTADO(A)';
  const article = 'o(a)';
  const Article = 'O(A)';

  doc.setFont('times', 'bold');
  doc.text('NOME:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(data.serverName.toUpperCase(), 60, y);
  y += 6; // Reverted from 5

  doc.setFont('times', 'bold');
  doc.text('CPF:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(data.cpf || '---', 60, y);
  y += 6; // Reverted from 5

  doc.setFont('times', 'bold');
  doc.text('ESPÉCIE DE VÍNCULO:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(bondLabel, 70, y);
  y += 6; // Reverted from 5

  doc.setFont('times', 'bold');
  doc.text('ADMISSÃO:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(data.admissionDate || '---', 60, y);
  y += 6; // Reverted from 5

  doc.setFont('times', 'bold');
  doc.text('MATRÍCULA FUNCIONAL:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(data.registration, 75, y);
  y += 6; // Reverted from 5

  doc.setFont('times', 'bold');
  doc.text('VALOR LEGALMENTE DISPONÍVEL DE PARCELA:', 20, y);
  y += 8; // Reverted from 6

  doc.setFont('times', 'normal');
  doc.text(`- Para crédito novo: R$ ${formatCurrency(availableMargin).replace('R$', '').trim()} ( ${numberToWords(availableMargin)} )`, 30, y);
  y += 6; // Reverted from 5
  doc.text(`- Para renovação : R$ ${formatCurrency(result.renewalMargin).replace('R$', '').trim()} ( ${numberToWords(result.renewalMargin)} )`, 30, y);
  y += 12; // Reverted from 10

  const bodyPart1 = `Esta proposta - por parte ${article} ${bondName.toLowerCase()} - permanecerá válida por 30 dias e este Ente Administrativo se compromete a realizar a averbação (consignação) e operar os descontos das parcelas após a confirmação da contratação do empréstimo e das parcelas pelo ${getBankFullName(bank)}, por meio da troca de arquivos eletrônicos.`;
  
  const bodyPart2 = `${Article} ${bondName.toLowerCase()} também autoriza expressamente, de forma irretratável e irrevogável, o desconto dos valores em seus proventos pelo INSTITUTO DE PREVIDÊNCIA DO MUNICÍPIO DE EUSÉBIO correspondente à parcela do empréstimo consignado concedido pelo ${getBankFullName(bank)}, conforme firmado entre a Instituição Bancária e ${article} ${bondName.toLowerCase()}.`;
  
  doc.text(bodyPart1, 20, y, { align: 'justify', maxWidth: 170 });
  y += 20; // Reverted from 16/18
  doc.text(bodyPart2, 20, y, { align: 'justify', maxWidth: 170 });
  y += 30; // Reverted from 20/25

  doc.text(dateStr, 105, y, { align: 'center' });
  y += 25; // Reverted from 15/20

  // Signatures
  doc.setTextColor(0);
  doc.line(20, y, 90, y);
  doc.line(120, y, 190, y);
  y += 5;
  doc.setFont('times', 'bold');
  doc.text(`${bondName.toUpperCase()} PROPONENTE`, 55, y, { align: 'center' });
  doc.text(signatory.name, 155, y, { align: 'center' });
  y += 5;
  doc.setFont('times', 'normal');
  doc.text(`Matrícula ${signatory.registration}`, 155, y, { align: 'center' });
  y += 5;
  doc.setFont('times', 'bold');
  doc.text(signatory.position, 155, y, { align: 'center' });

  drawFooter(doc);

  console.log('Saving PDF...');
  doc.save(`Carta_Margem_${bank}_${data.serverName.replace(/[^a-z0-9]/gi, '_')}.pdf`);
  console.log('PDF saved successfully');
}

export async function generateSummaryPDF(
  bank: Bank,
  data: PaystubData,
  result: CalculationResult
) {
  console.log('Generating Summary PDF for:', data.serverName);
  const doc = new jsPDF();
  
  // CONFIGURAÇÃO DO LOGOTIPO
  const EXTERNAL_LOGO_URL = 'https://raw.githubusercontent.com/pliniocatunda-commits/cartamargem/main/public/logo-ipme.png';
  
  let logoData: string | null = null;
  let logoWidth = 30;
  let logoHeight = 30;
  
  try {
    let logoBlob = await fetchLogo(`${window.location.origin}/logo-ipme.png`);
    let decoded = logoBlob ? await decodeLogo(logoBlob) : null;

    if (!decoded) {
      logoBlob = await fetchLogo(EXTERNAL_LOGO_URL);
      decoded = logoBlob ? await decodeLogo(logoBlob) : null;
    }

    if (decoded) {
      logoData = decoded.data;
      // Maintain aspect ratio if possible
      const ratio = decoded.width / decoded.height;
      if (ratio > 1) {
        logoHeight = logoWidth / ratio;
      } else {
        logoWidth = logoHeight * ratio;
      }
    }
  } catch (e) {
    console.error('Error loading logo for summary:', e);
  }

  // --- HEADER DESIGN ---
  // Background bar for header
  doc.setFillColor(248, 249, 250);
  doc.rect(0, 0, 210, 50, 'F');
  doc.setDrawColor(200, 200, 200);
  doc.line(0, 50, 210, 50);

  if (logoData) {
    doc.addImage(logoData, 'PNG', 20, 10, logoWidth, logoHeight);
  }
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59); // Slate 800
  doc.text('DEMONSTRATIVO DE MARGEM', 190, 25, { align: 'right' });
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139); // Slate 500
  doc.text('IPME - Instituto de Previdência do Município de Eusébio', 190, 32, { align: 'right' });
  doc.text('Sistema de Gestão de Margem Consignável', 190, 37, { align: 'right' });

  let y = 65;

  // Helper function for section headers
  const drawSectionHeader = (title: string, yPos: number) => {
    doc.setFillColor(30, 41, 59); // Slate 800
    doc.rect(20, yPos - 5, 170, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(title, 25, yPos);
    return yPos + 8;
  };

  // --- SECTION 1: IDENTIFICAÇÃO ---
  y = drawSectionHeader('1. IDENTIFICAÇÃO DO SERVIDOR', y);
  
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85); // Slate 700
  
  const leftCol = 25;
  const rightCol = 110;
  
  // Row 1
  doc.setFont('helvetica', 'bold'); doc.text('NOME:', leftCol, y);
  doc.setFont('helvetica', 'normal'); doc.text(data.serverName || 'NÃO INFORMADO', leftCol + 12, y);
  y += 6;
  
  // Row 2
  doc.setFont('helvetica', 'bold'); doc.text('CPF:', leftCol, y);
  doc.setFont('helvetica', 'normal'); doc.text(data.cpf || '---', leftCol + 10, y);
  
  doc.setFont('helvetica', 'bold'); doc.text('MATRÍCULA:', rightCol, y);
  doc.setFont('helvetica', 'normal'); doc.text(data.registration || '---', rightCol + 22, y);
  y += 6;
  
  // Row 3
  doc.setFont('helvetica', 'bold'); doc.text('VÍNCULO:', leftCol, y);
  doc.setFont('helvetica', 'normal'); doc.text(data.bondType === '05' ? 'PENSIONISTA' : 'APOSENTADO', leftCol + 15, y);
  
  doc.setFont('helvetica', 'bold'); doc.text('ADMISSÃO:', rightCol, y);
  doc.setFont('helvetica', 'normal'); doc.text(data.admissionDate || '---', rightCol + 22, y);
  y += 6;

  // Row 4
  doc.setFont('helvetica', 'bold'); doc.text('MÊS/ANO REF:', leftCol, y);
  doc.setFont('helvetica', 'normal'); doc.text(data.referencePeriod || '---', leftCol + 22, y);
  
  y += 10;

  // --- SECTION 2: COMPOSIÇÃO FINANCEIRA E MARGEM ---
  y = drawSectionHeader('2. COMPOSIÇÃO FINANCEIRA E MARGEM', y);
  
  const netIncome = data.grossValue - data.irrf - data.pension;
  const committedPercent = netIncome > 0 ? (result.totalConsigned / netIncome) * 100 : 0;

  const financialData = [
    ['Total de Vencimentos (Bruto)', formatCurrency(data.grossValue), 'text-blue-700'],
    ['Imposto de Renda (IRRF)', `(-) ${formatCurrency(data.irrf)}`, 'text-red-600'],
    ['Previdência Municipal', `(-) ${formatCurrency(data.pension)}`, 'text-red-600'],
    ['Renda Líquida Mensal', formatCurrency(netIncome), 'text-blue-700'],
    ['Margem 35% (Limite Legal)', formatCurrency(result.baseMargin), 'text-blue-700'],
    ['Total de Empréstimos Ativos', formatCurrency(result.totalConsigned), 'text-amber-600'],
    ['Margem Disponível (Novo Crédito)', formatCurrency(result.newLoanMargin), result.newLoanMargin >= 0 ? 'text-green-700' : 'text-red-700'],
    ['Percentual Comprometido', `${committedPercent.toFixed(2)}%`, committedPercent >= 35 ? 'text-red-700' : 'text-blue-700'],
  ];

  doc.setFontSize(8.5);
  financialData.forEach(([label, value, color]) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(51, 65, 85);
    doc.text(label, 25, y);
    
    if (color === 'text-red-600' || color === 'text-red-700') doc.setTextColor(185, 28, 28);
    else if (color === 'text-blue-700') doc.setTextColor(29, 78, 216);
    else if (color === 'text-green-700') doc.setTextColor(21, 128, 61);
    else if (color === 'text-amber-600') doc.setTextColor(217, 119, 6);
    else doc.setTextColor(51, 65, 85);
    
    doc.text(value, 185, y, { align: 'right' });
    doc.setTextColor(51, 65, 85);
    y += 6;
  });

  y += 6;

  // --- SECTION 3: CONSIGNADOS ---
  y = drawSectionHeader('3. DETALHAMENTO DE EMPRÉSTIMOS ATIVOS', y);
  
  if (data.consignedLoans.length > 0) {
    // Table Header
    doc.setFillColor(241, 245, 249); // Slate 100
    doc.rect(20, y - 4, 170, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105); // Slate 600
    doc.text('INSTITUIÇÃO BANCÁRIA', 25, y);
    doc.text('VALOR DA PARCELA (R$)', 185, y, { align: 'right' });
    y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    
    data.consignedLoans.forEach((loan, index) => {
      if (index % 2 === 0) {
        doc.setFillColor(252, 252, 252);
        doc.rect(20, y - 4, 170, 5, 'F');
      }
      doc.text(loan.bank.toUpperCase(), 25, y);
      doc.text(formatCurrency(loan.value), 185, y, { align: 'right' });
      y += 5;
    });
    
    doc.setDrawColor(226, 232, 240); // Slate 200
    doc.line(20, y - 1, 190, y - 1);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL DE COMPROMETIMENTO MENSAL:', 25, y);
    doc.text(formatCurrency(result.totalConsigned), 185, y, { align: 'right' });
  } else {
    doc.setFont('helvetica', 'italic');
    doc.text('Nenhum empréstimo consignado identificado no contracheque.', 25, y);
  }

  y += 10;

  // --- SECTION 4: RESULTADO PARA RENOVAÇÃO ---
  y = drawSectionHeader('4. ANÁLISE PARA RENOVAÇÃO', y);
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(`Margem para Renovação (${bank}):`, 25, y);
  doc.setFontSize(11);
  doc.setTextColor(29, 78, 216); // Blue 700
  doc.text(formatCurrency(result.renewalMargin), 185, y, { align: 'right' });

  y += 8;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 116, 139);
  doc.text('* Este demonstrativo possui caráter informativo e não substitui a Carta Margem oficial para fins de averbação.', 25, y);

  // --- FOOTER ---
  const now = new Date();
  const dateStr = `Relatório gerado eletronicamente em: ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR')}`;
  
  doc.setDrawColor(226, 232, 240);
  doc.line(20, 275, 190, 275);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // Slate 400
  doc.text(dateStr, 105, 282, { align: 'center' });
  doc.text('LPC Sistemas e Assessoria - Gestão Previdenciária Inteligente', 105, 287, { align: 'center' });
  doc.text('Página 1 de 1', 190, 287, { align: 'right' });

  doc.save(`Relatorio_Margem_${data.serverName.replace(/[^a-z0-9]/gi, '_')}.pdf`);
}

function getBankFullName(bank: Bank): string {
  switch (bank) {
    case 'BB': return 'Banco do Brasil S.A.';
    case 'CEF': return 'Caixa Econômica Federal';
    case 'BRADESCO': return 'Banco Bradesco S.A.';
    case 'ITAU': return 'Itaú Unibanco S.A.';
    default: return bank;
  }
}
