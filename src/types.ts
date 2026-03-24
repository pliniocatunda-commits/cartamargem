export type Bank = 'BB' | 'CEF' | 'BRADESCO' | 'ITAU';

export interface ConsignedLoan {
  id: string;
  bank: string;
  value: number;
}

export interface PaystubData {
  serverName: string;
  registration: string;
  cpf?: string;
  admissionDate?: string;
  bondType?: '05' | '06';
  gender?: 'M' | 'F';
  grossValue: number;
  irrf: number;
  pension: number;
  consignedLoans: ConsignedLoan[];
}

export interface CalculationResult {
  baseMargin: number;
  totalConsigned: number;
  consignedOtherBanks: number;
  newLoanMargin: number;
  renewalMargin: number;
  isViable: boolean;
}

export interface Signatory {
  name: string;
  registration: string;
  position: string;
}
