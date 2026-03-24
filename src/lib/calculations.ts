import { CalculationResult, PaystubData, Bank } from '../types';

export const MARGIN_PERCENTAGE = 0.35;

export function calculateMargin(data: PaystubData, selectedBank: Bank): CalculationResult {
  const baseMargin = (data.grossValue - data.irrf - data.pension) * MARGIN_PERCENTAGE;
  
  const totalConsigned = (data.consignedLoans || []).reduce((acc, loan) => acc + loan.value, 0);
  
  // Robust normalization: remove accents, uppercase, trim
  const normalize = (str: string) => 
    str.normalize("NFD")
       .replace(/[\u0300-\u036f]/g, "")
       .toUpperCase()
       .trim();

  const selectedBankId = selectedBank;
  
  const isSameBank = (loanBankRaw: string, targetBankId: Bank): boolean => {
    const loanBank = normalize(loanBankRaw);
    const target = normalize(targetBankId);

    // Direct ID match
    if (loanBank === target) return true;

    // Alias matching
    if (target === 'BB') {
      return loanBank.includes('BRASIL') || loanBank === 'BB' || loanBank.includes('B.BRASIL');
    }
    if (target === 'CEF') {
      return loanBank.includes('CAIXA') || loanBank === 'CEF' || loanBank.includes('ECONOMICA');
    }
    if (target === 'BRADESCO') {
      return loanBank.includes('BRADESCO');
    }
    if (target === 'ITAU') {
      return loanBank.includes('ITAU');
    }

    return false;
  };

  const consignedOtherBanks = (data.consignedLoans || [])
    .filter(loan => !isSameBank(loan.bank, selectedBankId))
    .reduce((acc, loan) => acc + loan.value, 0);

  const newLoanMargin = baseMargin - totalConsigned;
  const renewalMargin = baseMargin - consignedOtherBanks;

  return {
    baseMargin,
    totalConsigned,
    consignedOtherBanks,
    newLoanMargin,
    renewalMargin,
    isViable: renewalMargin > 0,
  };
}
