import React, { useState } from 'react';
import { 
  Building2, 
  FileText, 
  Calculator, 
  Download, 
  Upload, 
  Plus, 
  Trash2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Bank, PaystubData, ConsignedLoan, CalculationResult, Signatory } from './types';
import { calculateMargin } from './lib/calculations';
import { generateLetterPDF } from './lib/pdfGenerator';
import { cn, formatCurrency, parseCurrencyInput, formatCurrencyInput } from './lib/utils';

const BANKS: { id: Bank; name: string; color: string; code?: string }[] = [
  { id: 'BB', name: 'Banco do Brasil', color: 'bg-[#FCF000]', code: '19' },
  { id: 'CEF', name: 'Caixa Econômica', color: 'bg-[#005CA9]', code: '28' },
  { id: 'BRADESCO', name: 'Bradesco', color: 'bg-[#CC092F]', code: '41' },
  { id: 'ITAU', name: 'Itaú', color: 'bg-[#EC7000]', code: '56' },
];

import { parsePaystubPDF, parsePaystubWithAI, PDFParsingError } from './lib/pdfParser';
import { parsePaystubXML } from './lib/xmlParser';
import { parsePaystubExcel } from './lib/excelParser';

export default function App() {
  const [step, setStep] = useState(1);
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);
  const [paystubData, setPaystubData] = useState<PaystubData>({
    serverName: '',
    registration: '',
    cpf: '',
    admissionDate: '',
    bondType: '06',
    grossValue: 0,
    irrf: 0,
    pension: 0,
    consignedLoans: [],
  });

  const [signatory, setSignatory] = useState<Signatory>(() => {
    const saved = localStorage.getItem('signatory');
    return saved ? JSON.parse(saved) : {
      name: 'Mikaely da Silva Vieira',
      registration: '210189',
      position: 'ASSESSORA DE APOIO ADMINISTRATIVO'
    };
  });

  React.useEffect(() => {
    localStorage.setItem('signatory', JSON.stringify(signatory));
  }, [signatory]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<'LOAD_ERROR' | 'EXTRACT_ERROR' | 'VALIDATION_ERROR' | 'SCANNED_ERROR' | 'AI_ERROR' | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleSimulateUpload = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setExtractionError(null);
    setErrorType(null);
    setAiStatus(null);
    
    try {
      let extracted: Partial<PaystubData>;
      
      const fileName = file.name.toLowerCase();
      
      // Route based on file type
      if (fileName.endsWith('.xml')) {
        setAiStatus('Lendo arquivo XML...');
        extracted = await parsePaystubXML(file);
      } else if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
        setAiStatus('Lendo arquivo Excel...');
        extracted = await parsePaystubExcel(file);
      } else if (file.type.startsWith('image/')) {
        setAiStatus('Analisando imagem com IA...');
        extracted = await parsePaystubWithAI(file);
      } else {
        // 1. Try standard text extraction first (fastest)
        try {
          extracted = await parsePaystubPDF(file);
        } catch (err: any) {
          // 2. If it's a scanned PDF or unrecognized layout, try AI fallback
          if (err instanceof PDFParsingError && (err.type === 'SCANNED_ERROR' || err.type === 'VALIDATION_ERROR')) {
            setAiStatus('Iniciando análise inteligente (IA)...');
            extracted = await parsePaystubWithAI(file);
          } else {
            throw err;
          }
        }
      }
      
      setPaystubData({
        serverName: extracted.serverName || 'SERVIDOR NÃO IDENTIFICADO',
        registration: extracted.registration || '',
        cpf: extracted.cpf || '',
        admissionDate: extracted.admissionDate || '',
        bondType: extracted.bondType || '06',
        grossValue: extracted.grossValue || 0,
        irrf: extracted.irrf || 0,
        pension: extracted.pension || 0,
        consignedLoans: extracted.consignedLoans || [],
      });

      // If some key values are still missing, warn the user
      if (!extracted.grossValue || !extracted.irrf) {
        setExtractionError('Alguns valores não foram identificados. Por favor, verifique e preencha manualmente.');
        setErrorType('VALIDATION_ERROR');
      }
    } catch (error: any) {
      console.error('Erro ao processar arquivo:', error);
      if (error instanceof PDFParsingError) {
        setExtractionError(error.message);
        setErrorType(error.type);
      } else {
        setExtractionError(error.message || 'Não foi possível ler o arquivo. Por favor, insira os dados manualmente.');
      }
      
      // If AI error, we still want to let the user proceed to manual entry
      if (error instanceof PDFParsingError && error.type === 'AI_ERROR') {
        setPaystubData({
          serverName: 'SERVIDOR NÃO IDENTIFICADO',
          registration: '',
          grossValue: 0,
          irrf: 0,
          pension: 0,
          consignedLoans: [],
        });
      }
    } finally {
      setIsProcessing(false);
      setAiStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const calculation = selectedBank ? calculateMargin(paystubData, selectedBank) : null;

  const handleAddLoan = () => {
    const newLoan: ConsignedLoan = {
      id: Math.random().toString(36).substr(2, 9),
      bank: '',
      value: 0,
    };
    setPaystubData({
      ...paystubData,
      consignedLoans: [...paystubData.consignedLoans, newLoan],
    });
  };

  const handleRemoveLoan = (id: string) => {
    setPaystubData({
      ...paystubData,
      consignedLoans: paystubData.consignedLoans.filter((l) => l.id !== id),
    });
  };

  const handleLoanChange = (id: string, field: keyof ConsignedLoan, value: string | number) => {
    setPaystubData({
      ...paystubData,
      consignedLoans: paystubData.consignedLoans.map((l) =>
        l.id === id ? { ...l, [field]: value } : l
      ),
    });
  };

  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const nextStep = () => setStep((s) => Math.min(s + 1, 4));
  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans selection:bg-black selection:text-white">
      {/* Header */}
      <header className="border-b border-[#141414]/10 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#141414] rounded-xl flex items-center justify-center text-white">
              <Calculator size={24} />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">MargemFacil</h1>
              <p className="text-[10px] text-blue-600 uppercase tracking-widest font-bold leading-tight">
                IPME - Instituto de Previdência do Município de Eusébio
              </p>
            </div>
          </div>
          
          <nav className="hidden md:flex items-center gap-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border",
                  step === i ? "bg-[#141414] text-white border-[#141414]" : 
                  step > i ? "bg-green-500 text-white border-green-500" : "border-[#141414]/20 text-[#141414]/40"
                )}>
                  {step > i ? <CheckCircle2 size={12} /> : i}
                </div>
                <span className={cn(
                  "text-xs font-semibold uppercase tracking-wider",
                  step === i ? "text-[#141414]" : "text-[#141414]/40"
                )}>
                  {i === 1 ? 'Banco' : i === 2 ? 'Dados' : i === 3 ? 'Cálculo' : 'Emissão'}
                </span>
              </div>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {/* Step 1: Bank Selection */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="max-w-2xl">
                <h2 className="text-4xl font-bold tracking-tight mb-4 italic font-serif">Selecione o Banco Destino</h2>
                <p className="text-lg text-[#141414]/60">
                  Escolha para qual instituição financeira a carta margem será emitida. Isso define o modelo do documento e as regras de renovação.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {BANKS.map((bank) => (
                  <button
                    key={bank.id}
                    onClick={() => {
                      setSelectedBank(bank.id);
                      nextStep();
                    }}
                    className={cn(
                      "group relative p-8 rounded-3xl border-2 transition-all duration-300 text-left overflow-hidden",
                      selectedBank === bank.id 
                        ? "border-[#141414] bg-white shadow-2xl scale-[1.02]" 
                        : "border-[#141414]/5 bg-white hover:border-[#141414]/20 hover:shadow-xl"
                    )}
                  >
                    <div className={cn(
                      "w-12 h-12 rounded-2xl mb-6 flex items-center justify-center shadow-lg", 
                      bank.color,
                      bank.id === 'BB' ? "text-[#141414]" : "text-white"
                    )}>
                      <Building2 size={24} />
                    </div>
                    <h3 className="font-bold text-xl mb-1">{bank.name}</h3>
                    <p className="text-sm text-[#141414]/50">Emitir carta para {bank.id}</p>
                    
                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight size={20} className="text-[#141414]/30" />
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 2: Paystub Data */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn("px-2 py-1 rounded text-[10px] font-bold text-white uppercase tracking-tighter", BANKS.find(b => b.id === selectedBank)?.color)}>
                      {BANKS.find(b => b.id === selectedBank)?.name}
                    </span>
                    <span className="text-[10px] font-bold text-[#141414]/30 uppercase tracking-widest">Banco Selecionado</span>
                  </div>
                  <h2 className="text-4xl font-bold tracking-tight mb-4 italic font-serif">Dados do Contracheque</h2>
                  <p className="text-lg text-[#141414]/60">
                    Insira as informações financeiras extraídas do relatório do servidor.
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={onFileChange}
                      accept=".pdf"
                      className="hidden"
                    />
                    <button 
                      onClick={handleSimulateUpload}
                      disabled={isProcessing}
                      className={cn(
                        "flex items-center gap-2 px-6 py-3 rounded-full bg-[#141414] text-white hover:scale-[1.02] transition-all text-sm font-bold shadow-lg shadow-black/10",
                        isProcessing && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {isProcessing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          {aiStatus || 'Processando...'}
                        </>
                      ) : (
                        <>
                          <Upload size={18} />
                          Extrair "Dados Contracheque" (PDF)
                        </>
                      )}
                    </button>
                  </div>
                  <AnimatePresence>
                    {extractionError && (
                      <motion.div 
                        key="extraction-error"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className={cn(
                          "flex flex-col gap-1 text-xs font-medium p-3 rounded-lg border",
                          errorType === 'VALIDATION_ERROR' 
                            ? "text-amber-600 bg-amber-50 border-amber-100" 
                            : "text-red-600 bg-red-50 border-red-100"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <AlertCircle size={14} />
                          {extractionError}
                        </div>
                        {errorType === 'SCANNED_ERROR' && (
                          <p className="text-[10px] opacity-70 ml-5">
                            Dica: Tente baixar o PDF original do portal do servidor em vez de usar uma foto.
                          </p>
                        )}
                        {errorType === 'VALIDATION_ERROR' && (
                          <p className="text-[10px] opacity-70 ml-5">
                            Dica: Você pode completar os campos que faltam manualmente abaixo.
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#141414]/40">Matrícula</label>
                        <input
                          type="text"
                          value={paystubData.registration}
                          onChange={(e) => setPaystubData({ ...paystubData, registration: e.target.value })}
                          placeholder="Ex: 123456-7"
                          maxLength={15}
                          className="w-full px-4 py-3 rounded-xl border border-[#141414]/10 focus:border-[#141414] focus:ring-0 transition-all outline-none font-semibold"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#141414]/40">Nome do Servidor</label>
                        <input
                          type="text"
                          value={paystubData.serverName}
                          onChange={(e) => setPaystubData({ ...paystubData, serverName: e.target.value })}
                          placeholder="Ex: João da Silva"
                          className="w-full px-4 py-3 rounded-xl border border-[#141414]/10 focus:border-[#141414] focus:ring-0 transition-all outline-none font-semibold"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#141414]/40">CPF</label>
                        <input
                          type="text"
                          value={paystubData.cpf}
                          onChange={(e) => setPaystubData({ ...paystubData, cpf: e.target.value })}
                          placeholder="000.000.000-00"
                          className="w-full px-4 py-3 rounded-xl border border-[#141414]/10 focus:border-[#141414] focus:ring-0 transition-all outline-none font-semibold"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#141414]/40">Data de Admissão</label>
                        <input
                          type="text"
                          value={paystubData.admissionDate}
                          onChange={(e) => setPaystubData({ ...paystubData, admissionDate: e.target.value })}
                          placeholder="DD/MM/AAAA"
                          className="w-full px-4 py-3 rounded-xl border border-[#141414]/10 focus:border-[#141414] focus:ring-0 transition-all outline-none font-semibold"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#141414]/40">Vínculo</label>
                        <select
                          value={paystubData.bondType}
                          onChange={(e) => setPaystubData({ ...paystubData, bondType: e.target.value as '05' | '06' })}
                          className="w-full px-4 py-3 rounded-xl border border-[#141414]/10 focus:border-[#141414] focus:ring-0 transition-all outline-none font-semibold bg-white"
                        >
                          <option value="06">06 - APOSENTADO</option>
                          <option value="05">05 - PENSIONISTA</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 block mb-1 whitespace-nowrap">Valor Bruto (Vantagens)</label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold opacity-30">R$</span>
                          <input
                            type="text"
                            value={formatCurrencyInput(paystubData.grossValue)}
                            onChange={(e) => setPaystubData({ ...paystubData, grossValue: parseCurrencyInput(e.target.value) })}
                            placeholder="0,00"
                            className="w-full pl-11 pr-4 py-3 rounded-xl border border-[#141414]/10 focus:border-[#141414] focus:ring-0 transition-all outline-none font-bold"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 block mb-1">IRRF</label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold opacity-30">R$</span>
                          <input
                            type="text"
                            value={formatCurrencyInput(paystubData.irrf)}
                            onChange={(e) => setPaystubData({ ...paystubData, irrf: parseCurrencyInput(e.target.value) })}
                            placeholder="0,00"
                            className="w-full pl-11 pr-4 py-3 rounded-xl border border-[#141414]/10 focus:border-[#141414] focus:ring-0 transition-all outline-none font-bold"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 block mb-1">Previdência Municipal</label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold opacity-30">R$</span>
                          <input
                            type="text"
                            value={formatCurrencyInput(paystubData.pension)}
                            onChange={(e) => setPaystubData({ ...paystubData, pension: parseCurrencyInput(e.target.value) })}
                            placeholder="0,00"
                            className="w-full pl-11 pr-4 py-3 rounded-xl border border-[#141414]/10 focus:border-[#141414] focus:ring-0 transition-all outline-none font-bold"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-xl">Empréstimos Consignados</h3>
                      <button
                        onClick={handleAddLoan}
                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#141414] text-white text-sm font-semibold hover:scale-105 transition-transform"
                      >
                        <Plus size={16} />
                        Adicionar
                      </button>
                    </div>

                    <div className="space-y-4">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {paystubData.consignedLoans.length === 0 ? (
                          <motion.div
                            key="empty-loans"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="py-12 border-2 border-dashed border-[#141414]/10 rounded-2xl flex flex-col items-center justify-center text-[#141414]/30"
                          >
                            <FileText size={48} strokeWidth={1} className="mb-2" />
                            <p className="text-sm font-medium">Nenhum consignado registrado</p>
                          </motion.div>
                        ) : (
                          paystubData.consignedLoans.map((loan) => (
                            <motion.div 
                              key={loan.id}
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              className="flex gap-4 items-end"
                            >
                              <div className="flex-1 space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Banco</label>
                                <select
                                  value={loan.bank}
                                  onChange={(e) => handleLoanChange(loan.id, 'bank', e.target.value)}
                                  className="w-full px-4 py-2 rounded-xl border border-[#141414]/10 outline-none focus:border-[#141414] bg-white font-medium"
                                >
                                  <option value="">Selecione o Banco</option>
                                  {BANKS.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                  ))}
                                  <option value="OUTROS">Outros Bancos</option>
                                </select>
                              </div>
                              <div className="w-40 space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Valor Parcela</label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold opacity-30">R$</span>
                                  <input
                                    type="text"
                                    value={formatCurrencyInput(loan.value)}
                                    onChange={(e) => handleLoanChange(loan.id, 'value', parseCurrencyInput(e.target.value))}
                                    placeholder="0,00"
                                    className="w-full pl-8 pr-4 py-2 rounded-xl border border-[#141414]/10 outline-none focus:border-[#141414] font-bold"
                                  />
                                </div>
                              </div>
                              <button
                                onClick={() => handleRemoveLoan(loan.id)}
                                className="p-2.5 rounded-xl text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 size={18} />
                              </button>
                            </motion.div>
                          ))
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-[#141414] text-white p-8 rounded-3xl shadow-2xl sticky top-24">
                    <h3 className="text-xs font-bold uppercase tracking-widest opacity-50 mb-6">Resumo Rápido</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center pb-4 border-b border-white/10">
                        <span className="text-sm opacity-70">Renda Bruta</span>
                        <span className="font-bold">{formatCurrency(paystubData.grossValue)}</span>
                      </div>
                      <div className="flex justify-between items-center pb-4 border-b border-white/10">
                        <span className="text-sm opacity-70">Total Descontos</span>
                        <span className="font-bold text-red-400">-{formatCurrency(paystubData.irrf + paystubData.pension)}</span>
                      </div>
                      <div className="flex justify-between items-center pb-4 border-b border-white/10">
                        <span className="text-sm opacity-70">Renda Líquida</span>
                        <span className="font-bold">{formatCurrency(paystubData.grossValue - paystubData.irrf - paystubData.pension)}</span>
                      </div>
                      <div className="flex justify-between items-center pb-4 border-b border-white/10">
                        <span className="text-sm opacity-70">Margem 35%</span>
                        <span className="font-bold text-green-400">{formatCurrency((paystubData.grossValue - paystubData.irrf - paystubData.pension) * 0.35)}</span>
                      </div>
                      <div className="flex justify-between items-center pb-4 border-b border-white/10">
                        <span className="text-sm opacity-70">Total Empréstimos</span>
                        <span className="font-bold text-amber-400">{formatCurrency(paystubData.consignedLoans.reduce((acc, l) => acc + l.value, 0))}</span>
                      </div>
                      <div className="flex justify-between items-center pb-4 border-b border-white/10">
                        <span className="text-sm opacity-70">Margem Disponível</span>
                        <span className="font-bold text-green-400">
                          {formatCurrency(Math.max(0, ((paystubData.grossValue - paystubData.irrf - paystubData.pension) * 0.35) - paystubData.consignedLoans.reduce((acc, l) => acc + l.value, 0)))}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-2">
                        <span className="text-sm opacity-70">Comprometido</span>
                        <span className={cn(
                          "text-2xl font-bold",
                          (paystubData.grossValue - paystubData.irrf - paystubData.pension > 0 && 
                           (paystubData.consignedLoans.reduce((acc, l) => acc + l.value, 0) / (paystubData.grossValue - paystubData.irrf - paystubData.pension)) * 100 >= 35)
                            ? "text-red-500"
                            : "text-white"
                        )}>
                          {paystubData.grossValue - paystubData.irrf - paystubData.pension > 0 
                            ? ((paystubData.consignedLoans.reduce((acc, l) => acc + l.value, 0) / (paystubData.grossValue - paystubData.irrf - paystubData.pension)) * 100).toFixed(1)
                            : '0.0'}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-8 border-t border-[#141414]/5">
                <button
                  onClick={prevStep}
                  className="flex items-center gap-2 px-6 py-3 rounded-full border border-[#141414]/10 font-bold hover:bg-white transition-colors"
                >
                  <ChevronLeft size={20} />
                  Voltar
                </button>
                <button
                  disabled={!paystubData.serverName || paystubData.grossValue <= 0}
                  onClick={nextStep}
                  className="flex items-center gap-2 px-8 py-4 rounded-full bg-[#141414] text-white font-bold hover:scale-105 transition-transform shadow-xl disabled:opacity-50 disabled:hover:scale-100"
                >
                  Próximo Passo
                  <ChevronRight size={20} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Calculation Results */}
          {step === 3 && calculation && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-8"
              id="step-3-container"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="max-w-2xl">
                  <h2 className="text-4xl font-bold tracking-tight mb-4 italic font-serif">Demonstrativo de Margem</h2>
                  <p className="text-lg text-[#141414]/60">
                    Confira os cálculos realizados com base no comprometimento de 35%.
                  </p>
                </div>
                
                <div className="bg-white px-6 py-4 rounded-2xl border border-[#141414]/5 shadow-sm flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/30">Matrícula</span>
                    <span className="text-sm font-mono font-bold text-[#141414]/80">{paystubData.registration || '---'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/30">Servidor(a)</span>
                    <span className="text-sm font-bold truncate max-w-[200px]">{paystubData.serverName || 'NÃO IDENTIFICADO'}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white p-10 rounded-[2.5rem] border border-[#141414]/5 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/5 rounded-bl-full" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#141414]/40 mb-8">Novo Empréstimo</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-[#141414]/60">Margem Disponível (Extra)</p>
                    <p className={cn(
                      "text-5xl font-bold tracking-tighter",
                      calculation.newLoanMargin >= 0 ? "text-green-600" : "text-red-500"
                    )}>
                      {formatCurrency(calculation.newLoanMargin)}
                    </p>
                  </div>
                  <div className="mt-8 pt-8 border-t border-[#141414]/5 flex items-center gap-3">
                    {calculation.newLoanMargin >= 0 ? (
                      <>
                        <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                          <CheckCircle2 size={18} />
                        </div>
                        <p className="text-sm font-semibold text-green-700">Margem positiva para novos contratos</p>
                      </>
                    ) : (
                      <>
                        <div className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                          <AlertCircle size={18} />
                        </div>
                        <p className="text-sm font-semibold text-red-700">Margem excedida para novos contratos</p>
                      </>
                    )}
                  </div>
                </div>

                <div className="bg-white p-10 rounded-[2.5rem] border border-[#141414]/5 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-bl-full" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#141414]/40 mb-8">Renovação {BANKS.find(b => b.id === selectedBank)?.name}</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-[#141414]/60">Margem para Operação (Total)</p>
                    <p className="text-5xl font-bold tracking-tighter text-blue-600">
                      {formatCurrency(calculation.renewalMargin)}
                    </p>
                  </div>
                  <div className="mt-8 pt-8 border-t border-[#141414]/5">
                    <p className="text-xs text-[#141414]/40 leading-relaxed">
                      * Este valor considera a liberação da margem atualmente ocupada por este banco, permitindo a quitação e novo aporte.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white p-8 rounded-3xl border border-[#141414]/5">
                <h3 className="font-bold text-xl mb-6">Detalhamento Técnico</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-widest text-[#141414]/40">Base de Cálculo (35%)</p>
                    <p className="text-xl font-bold">{formatCurrency(calculation.baseMargin)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-widest text-[#141414]/40">Consignações Atuais</p>
                    <p className="text-xl font-bold">{formatCurrency(calculation.totalConsigned)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-widest text-[#141414]/40">Outros Bancos</p>
                    <p className="text-xl font-bold">{formatCurrency(calculation.consignedOtherBanks)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-widest text-[#141414]/40">Comprometimento Atual</p>
                    <p className="text-xl font-bold">
                      {calculation.baseMargin > 0 
                        ? ((calculation.totalConsigned / calculation.baseMargin) * 35).toFixed(1) 
                        : "0.0"}%
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-4">
                <button
                  onClick={prevStep}
                  className="flex items-center gap-2 px-6 py-3 rounded-full border border-[#141414]/10 font-bold hover:bg-white transition-colors"
                >
                  <ChevronLeft size={20} />
                  Voltar
                </button>
                <button
                  onClick={nextStep}
                  className="flex items-center gap-2 px-8 py-4 rounded-full bg-[#141414] text-white font-bold hover:scale-105 transition-transform shadow-xl"
                >
                  Gerar Carta Margem
                  <Download size={20} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 4: Final Emission */}
          {step === 4 && calculation && selectedBank && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-3xl mx-auto text-center space-y-12 py-12"
            >
              <div className="space-y-4">
                <div className="w-24 h-24 bg-green-500 rounded-full mx-auto flex items-center justify-center text-white shadow-2xl shadow-green-500/20">
                  <CheckCircle2 size={48} />
                </div>
                <h2 className="text-4xl font-bold tracking-tight italic font-serif">Tudo Pronto!</h2>
                <p className="text-lg text-[#141414]/60">
                  A análise foi concluída com sucesso. Você já pode baixar a carta margem oficial para o servidor <strong>{paystubData.serverName}</strong>.
                </p>
              </div>

              <div className="bg-white p-12 rounded-[3rem] border border-[#141414]/5 shadow-2xl space-y-8">
                <div className="flex flex-col items-center gap-4">
                  <div className="p-6 bg-[#F5F5F0] rounded-3xl">
                    <FileText size={64} className="text-[#141414]/20" />
                  </div>
                  <div>
                    <h3 className="font-bold text-2xl">Carta_Margem_{selectedBank}.pdf</h3>
                    <p className="text-sm text-[#141414]/40">Documento gerado conforme padrões bancários</p>
                  </div>
                </div>

                <div className="border-t border-[#141414]/5 pt-8 space-y-6">
                  <div className="text-left">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-[#141414]/40 mb-4">Responsável pela Assinatura</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[#141414]/40 uppercase">Nome</label>
                        <input 
                          type="text" 
                          value={signatory.name}
                          onChange={(e) => setSignatory({ ...signatory, name: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-[#141414]/10 text-sm font-semibold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[#141414]/40 uppercase">Matrícula</label>
                        <input 
                          type="text" 
                          value={signatory.registration}
                          onChange={(e) => setSignatory({ ...signatory, registration: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-[#141414]/10 text-sm font-semibold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[#141414]/40 uppercase">Cargo</label>
                        <input 
                          type="text" 
                          value={signatory.position}
                          onChange={(e) => setSignatory({ ...signatory, position: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-[#141414]/10 text-sm font-semibold"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <button
                    onClick={prevStep}
                    className="flex items-center justify-center gap-3 py-5 rounded-2xl border border-[#141414]/10 text-[#141414] font-bold hover:bg-white transition-all"
                  >
                    <ChevronLeft size={24} />
                    Voltar
                  </button>
                  <button
                    onClick={() => generateLetterPDF(selectedBank, paystubData, calculation, signatory)}
                    className="flex items-center justify-center gap-3 py-5 rounded-2xl bg-[#141414] text-white font-bold hover:scale-[1.02] transition-transform shadow-xl"
                  >
                    <Download size={24} />
                    Baixar PDF
                  </button>
                  <button
                    onClick={() => setStep(1)}
                    className="flex items-center justify-center gap-3 py-5 rounded-2xl border-2 border-[#141414] text-[#141414] font-bold hover:bg-[#141414] hover:text-white transition-all"
                  >
                    Novo Cálculo
                  </button>
                </div>
              </div>

              <p className="text-xs text-[#141414]/30 max-w-md mx-auto">
                Ao baixar este documento, você confirma que as informações inseridas são verídicas e condizem com o contracheque oficial do servidor.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-auto py-12 border-t border-[#141414]/5">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-sm text-[#141414]/40 font-medium">© 2026 LPC sistemas e assessoria. Todos os direitos reservados.</p>
          <div className="flex gap-8">
            <a href="#" className="text-xs font-bold uppercase tracking-widest text-[#141414]/40 hover:text-[#141414] transition-colors">Privacidade</a>
            <a href="#" className="text-xs font-bold uppercase tracking-widest text-[#141414]/40 hover:text-[#141414] transition-colors">Termos de Uso</a>
            <a href="#" className="text-xs font-bold uppercase tracking-widest text-[#141414]/40 hover:text-[#141414] transition-colors">Suporte</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
