import { jsPDF } from 'jspdf';
import { Bank, PaystubData, CalculationResult } from '../types';
import { formatCurrency } from './utils';

export function generateLetterPDF(
  bank: Bank,
  data: PaystubData,
  result: CalculationResult
) {
  const doc = new jsPDF();
  const date = new Date().toLocaleDateString('pt-BR');

  // Header
  doc.setFontSize(16);
  doc.text('CARTA DE MARGEM CONSIGNÁVEL', 105, 20, { align: 'center' });
  
  doc.setFontSize(12);
  doc.text(`Ao Banco: ${getBankFullName(bank)}`, 20, 40);
  doc.text(`Data: ${date}`, 20, 50);

  // Content
  doc.setFontSize(11);
  const text = `
    Declaramos para os devidos fins que o servidor(a) ${data.serverName.toUpperCase()}, 
    Matrícula: ${data.registration},
    apresenta as seguintes condições de margem consignável para fins de empréstimo:

    1. Margem Base (35%): ${formatCurrency(result.baseMargin)}
    2. Total de Consignações Atuais: ${formatCurrency(result.totalConsigned)}
    
    RESULTADO DA APURAÇÃO:
    --------------------------------------------------
    NOVO EMPRÉSTIMO: ${formatCurrency(result.newLoanMargin)}
    RENOVAÇÃO ${getBankFullName(bank).toUpperCase()}: ${formatCurrency(result.renewalMargin)}
    --------------------------------------------------

    Esta margem foi calculada com base no último contracheque apresentado, 
    considerando o percentual legal de 35% de comprometimento da renda líquida.
  `;

  const splitText = doc.splitTextToSize(text, 170);
  doc.text(splitText, 20, 70);

  // Footer
  doc.text('__________________________________________', 105, 200, { align: 'center' });
  doc.text('Departamento de Recursos Humanos', 105, 210, { align: 'center' });

  doc.save(`Carta_Margem_${bank}_${data.serverName.replace(/\s+/g, '_')}.pdf`);
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
