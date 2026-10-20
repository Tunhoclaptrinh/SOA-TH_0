import type { BankStats, Charge } from '../contracts/bank.js';
import type { ChargeInput } from './types.js';

export class BankStore {
  private readonly byKey = new Map<string, Charge>();
  private readonly referenceCounts = new Map<string, number>();
  private readonly counters: BankStats = { connections: 0, requests: 0, charges: 0, duplicates: 0 };

  get stats(): BankStats {
    return { ...this.counters };
  }

  recordConnection(): number {
    return ++this.counters.connections;
  }
  recordRequest(): void {
    this.counters.requests += 1;
  }
  find(key: string): Charge | undefined {
    return this.byKey.get(key);
  }

  /** Chỉ gọi sau khi kiểm tra cache; không có await trong bước ghi giao dịch. */
  create({ key, reference, amount }: ChargeInput): Charge {
    const previous = this.referenceCounts.get(reference) ?? 0;
    if (previous > 0) {
      this.counters.duplicates += 1;
    }
    this.referenceCounts.set(reference, previous + 1);
    const charge: Charge = { chargeId: `C${++this.counters.charges}`, reference, amount };
    this.byKey.set(key, charge);
    return charge;
  }
}
