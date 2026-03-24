import { PaystubData, ConsignedLoan } from '../types';

/**
 * Parses a payroll XML file.
 * This is a generic parser that looks for common Brazilian payroll tags.
 */
export async function parsePaystubXML(file: File): Promise<Partial<PaystubData>> {
  try {
    const text = await file.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");

    // Helper to get text content from a tag name (case-insensitive-ish)
    const getTagValue = (names: string[]): string | null => {
      for (const name of names) {
        const elements = xmlDoc.getElementsByTagName(name);
        if (elements.length > 0) return elements[0].textContent;
        
        // Try uppercase/lowercase variations
        const upperElements = xmlDoc.getElementsByTagName(name.toUpperCase());
        if (upperElements.length > 0) return upperElements[0].textContent;
      }
      return null;
    };

    const serverName = getTagValue(['nome', 'nomeServidor', 'funcionario', 'nomeFuncionario', 'beneficiario']);
    const grossStr = getTagValue(['valorBruto', 'totalVantagens', 'totalProventos', 'rendimentoBruto', 'vencimentos']);
    const irrfStr = getTagValue(['irrf', 'impostoRenda', 'valorIRRF', 'descontoIRRF']);
    const pensionStr = getTagValue(['previdencia', 'iprev', 'contribuicaoPrevidenciaria', 'valorPrevidencia', 'rpps']);

    // Consigned loans are often in a list of discounts
    const consignedLoans: ConsignedLoan[] = [];
    const bankCodes: { [key: string]: string } = {
      '19': 'BB',
      '28': 'CEF',
      '41': 'BRADESCO',
      '56': 'ITAU'
    };
    
    // Try to find items/rubrics/verbas
    const items = xmlDoc.getElementsByTagName('item') || xmlDoc.getElementsByTagName('rubrica') || xmlDoc.getElementsByTagName('verba');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const code = item.getElementsByTagName('codigo')[0]?.textContent || 
                   item.getElementsByTagName('rubrica')[0]?.textContent || "";
      const desc = item.getElementsByTagName('descricao')[0]?.textContent || 
                   item.getElementsByTagName('nome')[0]?.textContent || "";
      const valueStr = item.getElementsByTagName('valor')[0]?.textContent || "0";
      
      const upperDesc = desc.toUpperCase();
      const isLoanByKeyword = upperDesc.includes('CONSIGNADO') || upperDesc.includes('EMPRESTIMO');
      const isLoanByCode = bankCodes[code] !== undefined;

      if (isLoanByKeyword || isLoanByCode) {
        consignedLoans.push({
          id: Math.random().toString(36).substr(2, 9),
          bank: bankCodes[code] || desc.replace(/CONSIGNADO|EMPRESTIMO/gi, '').trim() || 'Banco não identificado',
          value: parseFloat(valueStr.replace(',', '.')) || 0
        });
      }
    }

    return {
      serverName: serverName || undefined,
      grossValue: grossStr ? parseFloat(grossStr.replace(',', '.')) : undefined,
      irrf: irrfStr ? parseFloat(irrfStr.replace(',', '.')) : undefined,
      pension: pensionStr ? parseFloat(pensionStr.replace(',', '.')) : undefined,
      consignedLoans: consignedLoans.length > 0 ? consignedLoans : undefined,
    };
  } catch (error) {
    console.error('XML Parsing error:', error);
    throw new Error('Erro ao processar o arquivo XML. Verifique se o formato é válido.');
  }
}
