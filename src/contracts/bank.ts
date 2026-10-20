/** Hợp đồng HTTP giữa Fee Service và cổng ngân hàng. Số tiền tính bằng VND. */
export interface ChargeRequest {
  readonly reference: string;
  readonly amount: number;
}

export interface Charge extends ChargeRequest {
  readonly chargeId: string;
}

export interface BankStats {
  connections: number;
  requests: number;
  charges: number;
  duplicates: number;
}
