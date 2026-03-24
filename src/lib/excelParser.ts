import * as XLSX from 'xlsx';
import { PaystubData, ConsignedLoan } from '../types';

/**
 * Parses a payroll Excel file (XLS/XLSX).
 * This parser scans all cells for keywords and extracts values.
 */
export async function parsePaystubExcel(file: File): Promise<Partial<PaystubData>> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer);
    
    // We'll look at the first sheet
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convert to a 2D array for easier scanning
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    let serverName: string | undefined;
    let grossValue: number | undefined;
    let irrf: number | undefined;
    let pension: number | undefined;
    const consignedLoans: ConsignedLoan[] = [];

    // Helper to find a value in the cell next to a label
    const findValueNearLabel = (labels: string[]): number | undefined => {
      for (let r = 0; r < data.length; r++) {
        for (let c = 0; c < data[r].length; c++) {
          const cellValue = String(data[r][c] || '').toUpperCase();
          if (labels.some(label => cellValue.includes(label.toUpperCase()))) {
            // Look in the next few cells in the same row
            for (let offset = 1; offset <= 3; offset++) {
              const nextVal = data[r][c + offset];
              if (typeof nextVal === 'number') return nextVal;
              if (typeof nextVal === 'string' && /[\d]/.test(nextVal)) {
                return parseCurrency(nextVal);
              }
            }
          }
        }
      }
      return undefined;
    };

    // 1. Server Name
    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < data[r].length; c++) {
        const cellValue = String(data[r][c] || '').toUpperCase();
        if (cellValue.includes('NOME') || cellValue.includes('SERVIDOR') || cellValue.includes('FUNCIONÁRIO')) {
          const nextVal = data[r][c + 1] || data[r][c + 2];
          if (typeof nextVal === 'string' && nextVal.length > 5) {
            serverName = nextVal.trim();
            break;
          }
        }
      }
      if (serverName) break;
    }

    // 2. Financial Values
    grossValue = findValueNearLabel(['TOTAL VANTAGENS', 'TOTAL PROVENTOS', 'BRUTO', 'VENCIMENTOS', 'RENDIMENTO BRUTO']);
    irrf = findValueNearLabel(['IRRF', 'IMPOSTO DE RENDA', 'I.R.R.F']);
    pension = findValueNearLabel(['PREVIDÊNCIA', 'IPREV', 'CONTRIBUIÇÃO PREV', 'CPSS', 'RPPS']);

    // 3. Consigned Loans
    const bankCodes: { [key: string]: string } = {
      '19': 'BB',
      '28': 'CEF',
      '41': 'BRADESCO',
      '56': 'ITAU'
    };

    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < data[r].length; c++) {
        const cellValue = String(data[r][c] || '').toUpperCase();
        const codeValue = String(data[r][c-1] || '').trim(); // Check previous cell for code

        const isLoanByKeyword = cellValue.includes('CONSIGNADO') || cellValue.includes('EMPRÉSTIMO') || cellValue.includes('EMPR');
        const isLoanByCode = bankCodes[codeValue] !== undefined;

        if (isLoanByKeyword || isLoanByCode) {
          let bankName = bankCodes[codeValue] || cellValue.replace(/CONSIGNADO|EMPRÉSTIMO|EMPR|PARC\.?\s?EMPR|CONSIG/gi, '').trim();
          
          // Look for value in the same row
          let value: number | undefined;
          for (let offset = 1; offset <= 5; offset++) {
            const nextVal = data[r][c + offset];
            if (typeof nextVal === 'number') {
              value = nextVal;
              break;
            }
            if (typeof nextVal === 'string' && /[\d]/.test(nextVal)) {
              value = parseCurrency(nextVal);
              break;
            }
          }

          if (value && value > 0) {
            consignedLoans.push({
              id: Math.random().toString(36).substr(2, 9),
              bank: bankName || 'Banco não identificado',
              value: value
            });
          }
        }
      }
    }

    return {
      serverName,
      grossValue,
      irrf,
      pension,
      consignedLoans: consignedLoans.length > 0 ? consignedLoans : undefined,
    };
  } catch (error) {
    console.error('Excel Parsing error:', error);
    throw new Error('Erro ao processar o arquivo Excel. Verifique se o formato é válido.');
  }
}

function parseCurrency(val: string): number {
  if (!val) return 0;
  // Handle PT-BR formats (1.234,56 -> 1234.56)
  const clean = val.replace(/[^\d,]/g, '').replace(',', '.');
  return parseFloat(clean) || 0;
}
