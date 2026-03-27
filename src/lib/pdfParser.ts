import * as pdfjsLib from 'pdfjs-dist';
import { GoogleGenAI, Type } from "@google/genai";
import { PaystubData, ConsignedLoan } from '../types';

// Using a more reliable worker initialization for Vite/Browser environments
const DEFAULT_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = DEFAULT_WORKER_URL;
  console.log('PDF.js worker initialized:', DEFAULT_WORKER_URL);
} catch (e) {
  console.warn('Failed to set workerSrc, PDF parsing might fail', e);
}

// Helper to get API key safely
const getApiKey = () => {
  // Try Vite env first, then process.env (for compatibility)
  const key = (import.meta as any).env?.VITE_GEMINI_API_KEY || 
              (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : '') || 
              '';
  return key;
};

export class PDFParsingError extends Error {
  constructor(public type: 'LOAD_ERROR' | 'EXTRACT_ERROR' | 'VALIDATION_ERROR' | 'SCANNED_ERROR' | 'AI_ERROR', message: string) {
    super(message);
    this.name = 'PDFParsingError';
  }
}

/**
 * Renders the first page of a PDF to a base64 image string.
 */
async function pdfToImage(arrayBuffer: ArrayBuffer): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  
  const viewport = page.getViewport({ scale: 1.5 }); // Balanced scale for OCR and token limits
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  
  if (!context) throw new Error('Could not create canvas context');
  
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  
  await page.render({
    canvasContext: context,
    viewport: viewport,
    // @ts-ignore - Some versions of pdfjs types might require canvas element directly
    canvas: canvas,
  }).promise;
  
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

/**
 * Converts a File to a base64 string.
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
}

/**
 * Uses Gemini AI to extract data from a PDF or Image.
 */
export async function parsePaystubWithAI(file: File): Promise<Partial<PaystubData>> {
  try {
    let base64Data: string;
    let mimeType: string;

    if (file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      base64Data = await pdfToImage(arrayBuffer);
      mimeType = 'image/jpeg'; // We render PDF to JPEG
    } else {
      base64Data = await fileToBase64(file);
      mimeType = file.type;
    }
    
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error('Gemini API Key is missing');
      throw new PDFParsingError('AI_ERROR', 'Chave de API do Gemini não configurada. Por favor, insira os dados manualmente.');
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            {
              text: `Extraia os dados deste contracheque brasileiro (holerite). Procure pelo nome do servidor, matrícula, CPF (pode estar perto do cargo ou nas observações), data de admissão, vínculo (05 para pensionista, 06 para aposentado), valor bruto (procure especificamente pelo campo 'TOTAL DE VENCIMENTOS' ou 'TOTAL DE VANTAGENS'). 
              IMPORTANTE: Não confunda com o 'TOTAL DE DESCONTOS'. O valor bruto é a soma das vantagens/vencimentos.
              Extraia também o mês e ano de referência (geralmente na segunda linha à direita, ex: 03/2024).
              Extraia também IRRF, Previdência e empréstimos consignados. 
              IMPORTANTE: Não confunda o valor do IRRF ou da Previdência com suas respectivas 'Bases de Cálculo', 'Rendimentos' ou descrições de isenção (ex: 'ISENTO DE IRRF'). O valor do IRRF/Previdência é um desconto (valor menor).
              Se o IRRF ou a Previdência não estiverem presentes, se o valor for zero, ou se houver a palavra 'ISENTO', retorne 0. Não use o valor bruto nesses campos.
              Use os seguintes códigos de rubrica para identificação precisa (PRIORIDADE MÁXIMA):
              - Código K9: IRRF
              - Código W1: PREVIDÊNCIA MUNICIPAL
              Para os empréstimos, identifique o banco pelo nome ou pelo código que aparece na coluna de código/rubrica:
              - Código 19: BB
              - Código 28: CEF
              - Código 41: BRADESCO
              - Código 56: ITAU
              No campo 'bank' do JSON, use preferencialmente os IDs: 'BB', 'CEF', 'BRADESCO' ou 'ITAU'.
              Retorne apenas o JSON.`
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 2048,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            serverName: { type: Type.STRING },
            registration: { type: Type.STRING },
            cpf: { type: Type.STRING },
            admissionDate: { type: Type.STRING },
            bondType: { type: Type.STRING, enum: ["05", "06"] },
            grossValue: { type: Type.NUMBER },
            irrf: { type: Type.NUMBER },
            pension: { type: Type.NUMBER },
            referencePeriod: { type: Type.STRING },
            consignedLoans: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  bank: { type: Type.STRING },
                  value: { type: Type.NUMBER }
                },
                required: ["bank", "value"]
              }
            }
          }
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    
    // Map AI result back to our types
    return {
      serverName: result.serverName,
      registration: result.registration,
      cpf: result.cpf,
      admissionDate: result.admissionDate,
      bondType: result.bondType,
      grossValue: result.grossValue,
      irrf: result.irrf,
      pension: result.pension,
      referencePeriod: result.referencePeriod,
      consignedLoans: result.consignedLoans?.map((loan: any) => ({
        id: Math.random().toString(36).substr(2, 9),
        bank: loan.bank,
        value: loan.value
      }))
    };
  } catch (error: any) {
    console.error('AI Extraction error:', error);
    throw new PDFParsingError('AI_ERROR', 'A análise inteligente falhou. Por favor, insira os dados manualmente.');
  }
}

/**
 * Converts PDF text content to a CSV-like string, preserving row structure.
 */
async function pdfToCSV(pdf: pdfjsLib.PDFDocumentProxy): Promise<string> {
  let csv = '';
  const Y_TOLERANCE = 5; // Pixels of tolerance for items on the same line

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Group items by their Y-coordinate (top to bottom)
    const items = textContent.items as any[];
    const rows: { [y: number]: any[] } = {};
    
    items.forEach(item => {
      const y = item.transform[5]; // Y-coordinate
      
      // Find an existing row within tolerance
      const existingY = Object.keys(rows).find(ry => Math.abs(Number(ry) - y) < Y_TOLERANCE);
      const targetY = existingY ? Number(existingY) : y;
      
      if (!rows[targetY]) rows[targetY] = [];
      rows[targetY].push(item);
    });
    
    // Sort Y-coordinates descending (top of page is higher Y in PDF space)
    const sortedY = Object.keys(rows).map(Number).sort((a, b) => b - a);
    
    sortedY.forEach(y => {
      // Sort items in the same row by X-coordinate (left to right)
      const rowItems = rows[y].sort((a, b) => a.transform[4] - b.transform[4]);
      // Join with semicolon to simulate CSV columns
      const rowText = rowItems.map(item => item.str).join(';');
      csv += rowText + '\n';
    });
  }
  return csv;
}

export async function parsePaystubPDF(file: File): Promise<Partial<PaystubData>> {
  try {
    if (!file) throw new PDFParsingError('LOAD_ERROR', 'Nenhum arquivo selecionado.');
    
    const arrayBuffer = await file.arrayBuffer();
    
    let pdf;
    try {
      const loadingTask = pdfjsLib.getDocument({ 
        data: arrayBuffer,
        useSystemFonts: true,
        isEvalSupported: false 
      });
      pdf = await loadingTask.promise;
    } catch (err: any) {
      console.error('PDF.js loading error:', err);
      throw new PDFParsingError('LOAD_ERROR', 'Erro ao carregar o documento PDF. O arquivo pode estar corrompido ou não é um PDF válido.');
    }
    
    // Convert PDF to CSV-like structure to preserve row relationships
    const csvContent = await pdfToCSV(pdf);
    const rows = csvContent.split('\n');

    // Check if we actually got any text
    if (!csvContent || csvContent.trim().length < 20) {
      throw new PDFParsingError('SCANNED_ERROR', 'Este PDF parece ser uma imagem (escaneado).');
    }

    // Enhanced Regex Patterns for Brazilian Paystubs (Servidor Público)
    // 1. Registration, Server Name, CPF, Admission Date, Bond Type
    let serverName: string | undefined;
    let registration: string | undefined;
    let cpf: string | undefined;
    let admissionDate: string | undefined;
    let bondType: '05' | '06' | undefined;
    let referencePeriod: string | undefined;

    // Look for registration (matricula), name, CPF, etc.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const columns = row.split(';');
      const upperRow = row.toUpperCase();
      
      // Specific logic for "RECIBO DE PAGAMENTO DE SALARIO"
      if (!referencePeriod && upperRow.includes('RECIBO DE PAGAMENTO DE SALARIO')) {
        // Look at the current row first, then the next row
        const rowsToSearch = [row, rows[i + 1] || ''];
        for (const r of rowsToSearch) {
          const upperR = r.toUpperCase();
          
          // 1. Try numerical format (MM/YYYY)
          const numMatch = r.match(/(\d{2}[\/\-\.]\d{4})/) || r.match(/(\d{2}[\/\-\.]\d{2})/);
          if (numMatch) {
            const mIndex = numMatch.index || 0;
            const mFull = numMatch[0];
            const cBefore = mIndex > 0 ? r[mIndex - 1] : '';
            const cAfter = mIndex + mFull.length < r.length ? r[mIndex + mFull.length] : '';
            const isFullDate = cBefore === '/' || cAfter === '/' || cBefore === '-' || cAfter === '-' || cBefore === '.' || cAfter === '.';
            
            if (!isFullDate) {
              referencePeriod = mFull;
              break;
            }
          }
          
          // 2. Try text format (MARÇO DE 2026 or MARÇO/2026)
          const monthRegex = /(JANEIRO|FEVEREIRO|MARÇO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)(?:\s+DE\s+|\s*\/\s*)(\d{4})/;
          const textMatch = upperR.match(monthRegex);
          if (textMatch) {
            const monthName = textMatch[1];
            const year = textMatch[2];
            const monthMap: { [key: string]: string } = {
              'JANEIRO': '01', 'FEVEREIRO': '02', 'MARÇO': '03', 'MARCO': '03',
              'ABRIL': '04', 'MAIO': '05', 'JUNHO': '06', 'JULHO': '07',
              'AGOSTO': '08', 'SETEMBRO': '09', 'OUTUBRO': '10', 'NOVEMBRO': '11', 'DEZEMBRO': '12'
            };
            referencePeriod = `${monthMap[monthName]}/${year}`;
            break;
          }
        }
      }

      // Match Reference Period: mm/yyyy (usually on the first few rows)
      if (!referencePeriod && i < 20) {
        // Look for labels first
        const hasRefLabel = upperRow.includes('MÊS/ANO') || 
                            upperRow.includes('REFERÊNCIA') || 
                            upperRow.includes('REF.') || 
                            upperRow.includes('COMPETÊNCIA') ||
                            upperRow.includes('MÊS REF');
                            
        const refMatch = row.match(/(\d{2}[\/\-\.]\d{4})/) || row.match(/(\d{2}[\/\-\.]\d{2})/);
        
        if (refMatch) {
          const matchIndex = refMatch.index || 0;
          const fullMatch = refMatch[0];
          
          // Check if it's part of a DD/MM/YYYY date
          const charBefore = matchIndex > 0 ? row[matchIndex - 1] : '';
          const charAfter = matchIndex + fullMatch.length < row.length ? row[matchIndex + fullMatch.length] : '';
          
          const isPartOfFullDate = charBefore === '/' || charAfter === '/' || charBefore === '-' || charAfter === '-' || charBefore === '.' || charAfter === '.';
          
          // If we have a label, we are more confident
          if (hasRefLabel) {
            referencePeriod = fullMatch;
          } else if (!isPartOfFullDate) {
            // If no label, only pick if it's not part of a full date
            // Also check if it's not just a year or something else
            if (fullMatch.length >= 5) {
              referencePeriod = fullMatch;
            }
          }
        }

        // Try text format if still not found (MARÇO DE 2026 or MARÇO/2026)
        if (!referencePeriod) {
          const monthRegex = /(JANEIRO|FEVEREIRO|MARÇO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)(?:\s+DE\s+|\s*\/\s*)(\d{4})/;
          const textMatch = upperRow.match(monthRegex);
          if (textMatch) {
            const monthName = textMatch[1];
            const year = textMatch[2];
            const monthMap: { [key: string]: string } = {
              'JANEIRO': '01', 'FEVEREIRO': '02', 'MARÇO': '03', 'MARCO': '03',
              'ABRIL': '04', 'MAIO': '05', 'JUNHO': '06', 'JULHO': '07',
              'AGOSTO': '08', 'SETEMBRO': '09', 'OUTUBRO': '10', 'NOVEMBRO': '11', 'DEZEMBRO': '12'
            };
            referencePeriod = `${monthMap[monthName]}/${year}`;
          }
        }
      }

      // Look for a registration pattern (usually a number with 4-10 digits)
      // and then a name in the same row or next row
      for (let j = 0; j < columns.length; j++) {
        const col = columns[j].trim();
        const upperCol = col.toUpperCase();
        
        // Match CPF: xxx.xxx.xxx-xx or xxxxxxxxxxx or C.P.F.: xxx.xxx.xxx-xx
        // Also look for CPF label and then the value in the next column or row
        if (!cpf) {
          const cpfMatch = col.match(/(?:C\.P\.F\.:\s*|CPF:\s*)?(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{11})/i);
          if (cpfMatch) {
            cpf = cpfMatch[1] || cpfMatch[2];
          } else if (upperCol.includes('CPF') || upperCol.includes('C.P.F.')) {
            // Check next column
            if (j + 1 < columns.length) {
              const nextColMatch = columns[j + 1].match(/(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{11})/);
              if (nextColMatch) cpf = nextColMatch[0];
            }
            // Check next row if not found
            if (!cpf && i + 1 < rows.length) {
              const nextRowMatch = rows[i + 1].match(/(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{11})/);
              if (nextRowMatch) cpf = nextRowMatch[0];
            }
          }
        }

        // Match Admission Date: dd/mm/yyyy
        if (!admissionDate) {
          const dateMatch = col.match(/(\d{2}\/\d{2}\/\d{4})/);
          if (dateMatch) {
            admissionDate = dateMatch[1];
          } else if (upperCol.includes('ADMISSÃO') || upperCol.includes('ADMISSAO')) {
            if (j + 1 < columns.length) {
              const nextColMatch = columns[j + 1].match(/(\d{2}\/\d{2}\/\d{4})/);
              if (nextColMatch) admissionDate = nextColMatch[0];
            }
            if (!admissionDate && i + 1 < rows.length) {
              const nextRowMatch = rows[i + 1].match(/(\d{2}\/\d{2}\/\d{4})/);
              if (nextRowMatch) admissionDate = nextRowMatch[0];
            }
          }
        }

        // Match Bond Type: 05 or 06
        if (!bondType) {
          if (col === '05' || col === '06') {
            bondType = col as '05' | '06';
          } else if (upperCol.includes('APOSENTADO')) {
            bondType = '06';
          } else if (upperCol.includes('PENSIONISTA')) {
            bondType = '05';
          }
        }

        // Match registration: 4 to 10 digits, possibly with a dash or leading zeros
        if (!registration) {
          const regMatch = col.match(/^(\d{4,10}(?:-\d)?)$/);
          if (regMatch) {
            registration = regMatch[1];
          }
        }

        // Match Server Name (if we have registration, look nearby)
        if (!serverName && registration && i < 20) {
          if (j + 1 < columns.length) {
            const nextCol = columns[j + 1].trim();
            if (nextCol.length > 5 && /^[A-ZÀ-Ú\s]+$/.test(nextCol.toUpperCase())) {
              serverName = nextCol;
            }
          }
        }
      }
    }

    // Special check for CPF below "Cargo" as requested by user
    if (!cpf) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].toUpperCase().includes('CARGO')) {
          // Check next 3 rows for a CPF pattern
          for (let k = 1; k <= 3; k++) {
            if (i + k < rows.length) {
              const match = rows[i + k].match(/(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{11})/);
              if (match) {
                cpf = match[0];
                break;
              }
            }
          }
        }
        if (cpf) break;
      }
    }

    // Fallback to 5th line if not found via registration reference
    if (!serverName && rows.length >= 5) {
      const candidate = rows[4].replace(/;/g, ' ').trim();
      const isHeader = /CÓD|DESCRIÇÃO|REFERÊNCIA|VENCIMENTOS|DESCONTOS/i.test(candidate);
      const hasTooManyDigits = (candidate.match(/\d/g) || []).length > 5;
      
      if (candidate.length > 5 && !isHeader && !hasTooManyDigits) {
        serverName = candidate;
      }
    }

    // Fallback to label-based search if 5th line is not valid
    if (!serverName) {
      const nameLabels = ['NOME DO SERVIDOR', 'NOME DO FUNCIONÁRIO', 'NOME', 'SERVIDOR', 'BENEFICIÁRIO', 'NOME DO SEGURADO'];
      for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const row = rows[i].toUpperCase();
        if (/CÓD|DESCRIÇÃO|REFERÊNCIA|VENCIMENTOS|DESCONTOS/i.test(row)) continue;

        const matchedLabel = nameLabels.find(label => row.includes(label));
        if (matchedLabel) {
          const afterLabel = rows[i].substring(rows[i].toUpperCase().indexOf(matchedLabel) + matchedLabel.length).replace(/;/g, ' ').trim();
          const nameMatch = afterLabel.match(/([A-ZÀ-Ú\s]{8,60})/);
          if (nameMatch && nameMatch[1].trim().length > 5) {
            serverName = nameMatch[1].trim();
            break;
          }
          
          if (i + 1 < rows.length) {
            const nextRow = rows[i + 1].trim().replace(/;/g, ' ');
            if (nextRow.length > 5 && !/[\d]{3,}/.test(nextRow)) {
              serverName = nextRow.trim();
              break;
            }
          }
        }
      }
    }

    // 2. Financial Values (IRRF and Pension in "Desconto" column)
    const findValue = (labels: string[], codes?: string[], exclude: string[] = []) => {
      // 1. Tentar por Código primeiro (mais preciso)
      if (codes) {
        for (let i = 0; i < rows.length; i++) {
          const columns = rows[i].split(';');
          const firstCol = columns[0]?.trim().toUpperCase();
          
          // Match exact code or code with leading zeros (e.g., "00K9" matches "K9")
          const codeMatch = codes.some(c => {
            const upperC = c.toUpperCase();
            return firstCol === upperC || firstCol.endsWith(upperC);
          });

          if (codeMatch) {
            for (let j = columns.length - 1; j >= 0; j--) {
              const col = columns[j].trim();
              const valueMatch = col.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/);
              if (valueMatch) return parseCurrency(valueMatch[1]);
            }
          }
        }
      }

      // 2. Tentar por Rótulo em ordem de prioridade
      for (const label of labels) {
        const upperLabel = label.toUpperCase();
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const upperRow = row.toUpperCase();
          
          if (upperRow.includes(upperLabel)) {
            // Skip if row contains any excluded terms (e.g., "BASE", "CÁLCULO")
            if (exclude.some(e => upperRow.includes(e.toUpperCase()))) continue;

            const columns = row.split(';');
            const isGrossSearch = upperLabel.includes('VANTAGEM') || upperLabel.includes('VENCIMENTO') || upperLabel.includes('BRUTO');
            
            // Se for busca de Bruto, pegamos o primeiro valor após o rótulo na mesma linha
            if (isGrossSearch) {
              const labelIndex = upperRow.indexOf(upperLabel);
              const textAfterLabel = row.substring(labelIndex + upperLabel.length);
              
              // Se houver "DESCONTO" na mesma linha, limitamos a busca até ele
              const discountPos = textAfterLabel.toUpperCase().indexOf('DESCONTO');
              const relevantPart = discountPos !== -1 ? textAfterLabel.substring(0, discountPos) : textAfterLabel;
              
              const partCols = relevantPart.split(';');
              for (const col of partCols) {
                const valueMatch = col.trim().match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/);
                if (valueMatch) return parseCurrency(valueMatch[1]);
              }
            }

            // Busca padrão na linha atual (da direita para a esquerda)
            for (let j = columns.length - 1; j >= 0; j--) {
              const col = columns[j].trim();
              const valueMatch = col.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/);
              if (valueMatch) return parseCurrency(valueMatch[1]);
            }
            
            // 3. Verificar próxima linha (valores abaixo dos rótulos)
            if (i + 1 < rows.length) {
              const nextRowCols = rows[i + 1].split(';');
              if (isGrossSearch) {
                // Se houver "DESCONTO" na próxima linha, pegamos o valor da esquerda
                const hasDiscountNext = rows[i + 1].toUpperCase().includes('DESCONTO');
                for (let j = 0; j < nextRowCols.length; j++) {
                  const col = nextRowCols[j].trim();
                  const valueMatch = col.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/);
                  if (valueMatch) {
                    const val = parseCurrency(valueMatch[1]);
                    if (val > 0) return val;
                  }
                  if (hasDiscountNext && j > 0) break;
                }
              } else {
                for (let j = nextRowCols.length - 1; j >= 0; j--) {
                  const col = nextRowCols[j].trim();
                  const valueMatch = col.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/);
                  if (valueMatch) return parseCurrency(valueMatch[1]);
                }
              }
            }

            // 4. Verificar linha anterior
            if (i > 0) {
              const prevRowCols = rows[i - 1].split(';');
              for (let j = prevRowCols.length - 1; j >= 0; j--) {
                const col = prevRowCols[j].trim();
                const valueMatch = col.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/);
                if (valueMatch) return parseCurrency(valueMatch[1]);
              }
            }
          }
        }
      }
      return undefined;
    };

    const grossValue = findValue(['TOTAL DE VENCIMENTOS', 'TOTAL DE VANTAGENS', 'Total de Vantagens', 'Total Proventos', 'Bruto', 'Rendimento Bruto', 'TOTAL VANTAGENS', 'VALOR BRUTO', 'Vencimentos']);
    const irrf = findValue(['IRRF', 'I.R.R.F', 'IMP. RENDA'], ['K9'], ['BASE', 'CÁLCULO', 'CALCULO', 'RENDIMENTO', 'VENCIMENTO', 'VANTAGEM', 'TOTAL', 'ISENTO', 'BENEFICIO', 'BENEFÍCIO']);
    const pension = findValue(['Previdência', 'IPREV', 'CONTRIBUIÇÃO PREV', 'CPSS', 'PREV. MUNICIPAL', 'RPPS', 'CONTRIB PREV', 'CONTRIBUIÇÃO PREVIDENCIÁRIA'], ['W1'], ['BASE', 'CÁLCULO', 'CALCULO', 'RENDIMENTO', 'VENCIMENTO', 'VANTAGEM', 'TOTAL', 'ISENTO']);

    // 3. Consigned Loans (Bank in "Descrição" column or via Code in first column)
    const consignedLoans: ConsignedLoan[] = [];
    const bankCodes: { [key: string]: string } = {
      '19': 'BB',
      '28': 'CEF',
      '41': 'BRADESCO',
      '56': 'ITAU'
    };
    
    // Scan rows for loans
    for (const row of rows) {
      const upperRow = row.toUpperCase();
      const columns = row.split(';');
      if (columns.length < 2) continue;

      const code = columns[0].trim();
      const description = columns[1].trim();
      const upperDesc = description.toUpperCase();

      // Check if it's a loan by keyword OR by known bank code
      const isLoanByKeyword = upperDesc.includes('CONSIGNADO') || upperDesc.includes('EMPRÉSTIMO') || upperDesc.includes('EMPR') || upperDesc.includes('CONSIG');
      const isLoanByCode = bankCodes[code] !== undefined;

      if (isLoanByKeyword || isLoanByCode) {
        // Find the value in this row (usually in the "Desconto" column)
        let value: number | undefined;
        for (let j = columns.length - 1; j >= 0; j--) {
          const col = columns[j].trim();
          const valueMatch = col.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/);
          if (valueMatch) {
            value = parseCurrency(valueMatch[1]);
            break;
          }
        }

        if (value && value > 0) {
          let bankId = bankCodes[code];
          
          if (!bankId) {
            const normalizedDesc = description.toUpperCase();
            if (normalizedDesc.includes('BRASIL') || normalizedDesc.includes(' BB ')) bankId = 'BB';
            else if (normalizedDesc.includes('CAIXA') || normalizedDesc.includes('CEF')) bankId = 'CEF';
            else if (normalizedDesc.includes('BRADESCO')) bankId = 'BRADESCO';
            else if (normalizedDesc.includes('ITAU')) bankId = 'ITAU';
          }

          const bankName = bankId || description.replace(/CONSIGNADO|EMPRÉSTIMO|EMPR|PARC\.?\s?EMPR|CONSIG/gi, '').trim();
          
          if (bankName.length > 1 && !/TOTAL|DESCONTO|LIQUIDO/i.test(bankName)) {
            consignedLoans.push({
              id: Math.random().toString(36).substr(2, 9),
              bank: bankName,
              value: value,
            });
          }
        }
      }
    }

    // Validation check: if absolutely nothing was found, it might be an unsupported layout
    if (!serverName && !grossValue && !irrf && !pension && consignedLoans.length === 0) {
      throw new PDFParsingError('VALIDATION_ERROR', 'O texto foi lido, mas nenhum dado financeiro foi identificado.');
    }

    return {
      serverName,
      registration,
      cpf,
      admissionDate,
      bondType,
      referencePeriod,
      grossValue,
      irrf,
      pension,
      consignedLoans: consignedLoans.length > 0 ? consignedLoans : undefined,
    };
  } catch (error: any) {
    if (error instanceof PDFParsingError) throw error;
    throw new Error('Ocorreu um erro inesperado ao processar o PDF.');
  }
}

function parseCurrency(val: string): number {
  if (!val) return 0;
  // Handle PT-BR formats (1.234,56 -> 1234.56)
  const clean = val.replace(/[^\d,]/g, '').replace(',', '.');
  return parseFloat(clean) || 0;
}
