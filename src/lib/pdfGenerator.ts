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

export async function generateLetterPDF(
  bank: Bank,
  data: PaystubData,
  result: CalculationResult,
  signatory: Signatory
) {
  console.log('Generating PDF for:', data.serverName);
  const doc = new jsPDF();
  console.log('jsPDF instance created');
  
  // Load logo as base64 for better reliability in jsPDF
  let logoData: string | null = null;
  try {
    console.log('Fetching logo...');
    const response = await fetch('/logo-ipme.png');
    if (response.ok) {
      const blob = await response.blob();
      logoData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // Basic check if it's a valid data URL
          if (result.startsWith('data:image/png;base64,')) {
            resolve(result);
          } else {
            reject(new Error('Invalid PNG data URL'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      console.log('Logo loaded successfully');
    } else {
      console.warn('Logo not found (404)');
    }
  } catch (e) {
    console.error('Error loading logo:', e);
    logoData = null; // Ensure it's null if loading fails
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
        // Centering the logo: (210 - 60) / 2 = 75
        doc.addImage(logoData, 'PNG', 75, 10, 60, 30);
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
    doc.circle(92, 18, 1.5, 'F');
    doc.setFillColor(255, 230, 0); // Yellow
    doc.circle(98, 15, 1.5, 'F');
    doc.setFillColor(0, 200, 220); // Cyan
    doc.circle(105, 15, 1.5, 'F');
    doc.setFillColor(0, 0, 120); // Dark Blue
    doc.circle(112, 18, 1.5, 'F');
    doc.setFillColor(230, 0, 0); // Red
    doc.circle(118, 22, 1.5, 'F');
    
    // Arches (bodies)
    doc.setLineWidth(0.8);
    doc.setDrawColor(0, 180, 0); doc.line(90, 23, 94, 20);
    doc.setDrawColor(255, 230, 0); doc.line(96, 20, 100, 17);
    doc.setDrawColor(0, 200, 220); doc.line(103, 17, 107, 20);
    doc.setDrawColor(0, 0, 120); doc.line(110, 20, 114, 23);
    
    doc.setFont('times', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(0, 40, 100); 
    doc.text('IPME', 105, 28, { align: 'center' });

    doc.setFontSize(9);
    doc.setTextColor(0, 40, 100);
    doc.setFont('times', 'italic');
    doc.text('INSTITUTO DE PREVIDÊNCIA', 105, 33, { align: 'center' });
    doc.text('DO MUNICÍPIO DE EUSÉBIO', 105, 37, { align: 'center' });
  };

  const drawFooter = (doc: jsPDF) => {
    doc.setFontSize(8);
    doc.setTextColor(0, 50, 150); // BLUE footer as requested
    doc.text('INSTITUTO DE PREVIDÊNCIA DOS SERVIDORES PÚBLICOS MUNICIPAIS DE EUSÉBIO', 105, 275, { align: 'center' });
    doc.text('AV. CORONEL CÍCERO SÁ, 498, CENTRO, CEP: 61760435', 105, 280, { align: 'center' });
    doc.text('CNPJ: 04.865.123/0001-46', 105, 285, { align: 'center' });
    doc.text('TEL: (85) 9.8159-6242 | 9.8150-7797 | 9.8159-7140', 105, 290, { align: 'center' });
  };

  // --- PAGE 1: COMUNICADO ---
  drawHeader(doc);
  
  doc.setFontSize(16);
  doc.setFont('times', 'bold');
  doc.setTextColor(0);
  doc.text('COMUNICADO', 105, 70, { align: 'center' });

  doc.setFontSize(11);
  doc.setFont('times', 'normal');
  doc.text(dateStr, 190, 85, { align: 'right' });

  doc.setFont('times', 'bold');
  doc.text('Assunto: Solicitação de Informação de relativos Empréstimos Consignados', 20, 105);
  
  doc.text(`Ao Ilmo.(a) Sr.(a) Gerente Desta Instituição Bancária (${getBankFullName(bank)})`, 20, 120);

  doc.setFont('times', 'normal');
  const comunicadoPart1 = `Cumprimentando-o(a) cordialmente, venho através deste, SOLICITAR que, caso sejam concretizadas renovação, renegociação ou reparcelamento de empréstimos consignados por meio da Carta-Margem a que este comunicado se anexa, seja informado de imediato ao Instituto de Previdência do Município de Eusébio - IPME, pelo endereço de e-mail que segue: mikaely.vieira@ipmeusebio.ce.gov.br`;
  
  const comunicadoPart2 = `A motivação dessa solicitação se dá em virtude de manter o controle necessário para emissão de Cartas-Margens aos segurados, uma vez que as consignações ainda são manuais e de que tal conduta permite uma melhor aplicação da lei pertinente. Visando evitar qualquer eventualidade, reforçamos a cooperação da Instituição Bancária em favor deste Instituto de Previdência.`;

  // Render paragraphs separately to avoid justification issues with newlines
  doc.text(comunicadoPart1, 20, 130, { align: 'justify', maxWidth: 170 });
  
  // Calculate height of first paragraph to position the second one
  const dims1 = doc.getTextDimensions(comunicadoPart1, { maxWidth: 170 });
  const nextY = 130 + dims1.h + 8; // 8 units for a clear blank line
  
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

  doc.text('Ref.: Solicitação de Declaração de Margem Consignável com o fim de contratação de empréstimo consignado.', 20, 65, { maxWidth: 110 });

  doc.setFont('times', 'normal');
  doc.text('Senhor Gerente,', 20, 80);

  const introText = `O INSTITUTO DE PREVIDÊNCIA DO MUNICÍPIO DE EUSÉBIO, CNPJ nº 04.865.123/0001-46, vem por meio desta informar os dados abaixo para fins de concessão de empréstimo consignado em folha de pagamentos.`;
  doc.text(introText, 20, 85, { align: 'justify', maxWidth: 170 });

  let y = 105;
  const bondName = data.bondType === '05' ? 'PENSIONISTA' : 'APOSENTADO(A)';
  const bondLabel = data.bondType === '05' ? 'PENSIONISTA' : 'APOSENTADO(A)';
  const article = 'o(a)';
  const Article = 'O(A)';

  doc.setFont('times', 'bold');
  doc.text('NOME:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(data.serverName.toUpperCase(), 60, y);
  y += 6;

  doc.setFont('times', 'bold');
  doc.text('CPF:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(data.cpf || '---', 60, y);
  y += 6;

  doc.setFont('times', 'bold');
  doc.text('ESPÉCIE DE VÍNCULO:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(bondLabel, 70, y);
  y += 6;

  doc.setFont('times', 'bold');
  doc.text('ADMISSÃO:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(data.admissionDate || '---', 60, y);
  y += 6;

  doc.setFont('times', 'bold');
  doc.text('MATRÍCULA FUNCIONAL:', 20, y);
  doc.setFont('times', 'normal');
  doc.text(data.registration, 75, y);
  y += 6;

  doc.setFont('times', 'bold');
  doc.text('VALOR LEGALMENTE DISPONÍVEL DE PARCELA:', 20, y);
  y += 8;

  doc.setFont('times', 'normal');
  doc.text(`- Para crédito novo: R$ ${formatCurrency(availableMargin).replace('R$', '').trim()} ( ${numberToWords(availableMargin)} )`, 30, y);
  y += 6;
  doc.text(`- Para renovação : R$ ${formatCurrency(result.renewalMargin).replace('R$', '').trim()} ( ${numberToWords(result.renewalMargin)} )`, 30, y);
  y += 12;

  const bodyPart1 = `Esta proposta - por parte ${article} ${bondName.toLowerCase()} - permanecerá válida por 30 dias e este Ente Administrativo se compromete a realizar a averbação (consignação) e operar os descontos das parcelas após a confirmação da contratação do empréstimo e das parcelas pelo ${getBankFullName(bank)}, por meio da troca de arquivos eletrônicos.`;
  
  const bodyPart2 = `${Article} ${bondName.toLowerCase()} também autoriza expressamente, de forma irretratável e irrevogável, o desconto dos valores em seus proventos pelo INSTITUTO DE PREVIDÊNCIA DO MUNICÍPIO DE EUSÉBIO correspondente à parcela do empréstimo consignado concedido pelo ${getBankFullName(bank)}, conforme firmado entre a Instituição Bancária e ${article} ${bondName.toLowerCase()}.`;
  
  doc.text(bodyPart1, 20, y, { align: 'justify', maxWidth: 170 });
  y += 20;
  doc.text(bodyPart2, 20, y, { align: 'justify', maxWidth: 170 });
  y += 30;

  doc.text(dateStr, 105, y, { align: 'center' });
  y += 25;

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

function getBankFullName(bank: Bank): string {
  switch (bank) {
    case 'BB': return 'Banco do Brasil S.A.';
    case 'CEF': return 'Caixa Econômica Federal';
    case 'BRADESCO': return 'Banco Bradesco S.A.';
    case 'ITAU': return 'Itaú Unibanco S.A.';
    default: return bank;
  }
}
