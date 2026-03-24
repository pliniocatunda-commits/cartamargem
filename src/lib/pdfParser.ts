import * as pdfjsLib from 'pdfjs-dist';
import { GoogleGenAI, Type } from "@google/genai";
import { PaystubData, ConsignedLoan } from '../types';

// Using a more reliable worker initialization for Vite/Browser environments
const DEFAULT_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.5.207/build/pdf.worker.min.mjs';

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = DEFAULT_WORKER_URL;
} catch (e) {
  console.warn('Failed to set workerSrc, PDF parsing might fail');
}

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
  
  const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
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
    
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    
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
              text: `Extraia os dados deste contracheque brasileiro (holerite). Procure pelo nome do servidor, matrícula, valor bruto (total de vantagens), IRRF, Previdência e empréstimos consignados. 
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
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            serverName: { type: Type.STRING },
            registration: { type: Type.STRING },
            grossValue: { type: Type.NUMBER },
            irrf: { type: Type.NUMBER },
            pension: { type: Type.NUMBER },
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
      grossValue: result.grossValue,
      irrf: result.irrf,
      pension: result.pension,
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
    // 1. Registration and Server Name
    let serverName: string | undefined;
    let registration: string | undefined;

    // Look for registration (matricula) and name
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i];
      const columns = row.split(';');
      
      // Look for a registration pattern (usually a number with 4-10 digits)
      // and then a name in the same row or next row
      for (let j = 0; j < columns.length; j++) {
        const col = columns[j].trim();
        // Match registration: 4 to 10 digits, possibly with a dash or leading zeros
        const regMatch = col.match(/^(\d{4,10}(?:-\d)?)$/);
        
        if (regMatch) {
          registration = regMatch[1];
          
          // Name is usually right after the registration in the same row
          if (j + 1 < columns.length) {
            const nextCol = columns[j + 1].trim();
            if (nextCol.length > 5 && /^[A-ZÀ-Ú\s]+$/.test(nextCol.toUpperCase())) {
              serverName = nextCol;
              break;
            }
          }
          
          // Or in the next column if there's a gap
          if (!serverName && j + 2 < columns.length) {
            const nextCol = columns[j + 2].trim();
            if (nextCol.length > 5 && /^[A-ZÀ-Ú\s]+$/.test(nextCol.toUpperCase())) {
              serverName = nextCol;
              break;
            }
          }
        }
      }
      if (serverName) break;
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
    const findValue = (labels: string[], codes?: string[]) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const upperRow = row.toUpperCase();
        const columns = row.split(';');
        const firstCol = columns[0]?.trim().toUpperCase();

        // Check by Code first (more precise)
        const matchedByCode = codes && codes.some(c => firstCol === c.toUpperCase());
        
        // Check by Label
        const matchedByLabel = labels.some(label => upperRow.includes(label.toUpperCase()));

        if (matchedByCode || matchedByLabel) {
          // 1. Check current row (from right to left)
          for (let j = columns.length - 1; j >= 0; j--) {
            const col = columns[j].trim();
            const valueMatch = col.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/);
            if (valueMatch) return parseCurrency(valueMatch[1]);
          }
          
          // 2. Check next row (sometimes values are below labels)
          if (i + 1 < rows.length) {
            const nextRowCols = rows[i + 1].split(';');
            for (let j = nextRowCols.length - 1; j >= 0; j--) {
              const col = nextRowCols[j].trim();
              const valueMatch = col.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]{2})/);
              if (valueMatch) return parseCurrency(valueMatch[1]);
            }
          }

          // 3. Check previous row
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
      return undefined;
    };

    const grossValue = findValue(['Total de Vantagens', 'Total Proventos', 'Bruto', 'Vencimentos', 'Rendimento Bruto', 'TOTAL VANTAGENS', 'VALOR BRUTO']);
    const irrf = findValue(['IRRF', 'Imposto de Renda', 'I\.R\.R\.F', 'IMP\. RENDA', 'IMPOSTO DE RENDA RETIDO'], ['K9']);
    const pension = findValue(['Previdência', 'IPREV', 'CONTRIBUIÇÃO PREV', 'CPSS', 'PREV\. MUNICIPAL', 'RPPS', 'CONTRIB PREV', 'CONTRIBUIÇÃO PREVIDENCIÁRIA'], ['W1']);

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
