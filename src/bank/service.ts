import { setTimeout as sleep } from 'node:timers/promises';
import type { BankConfig } from '../shared/config.types.js';
import { AppError } from '../shared/errors.js';
import type { BankStore } from './store.js';
import type { ChargeDecision, ChargeInput } from './types.js';

export class ChargeService {
  constructor(
    private readonly store: BankStore,
    private readonly config: BankConfig,
    private readonly signal: AbortSignal,
    private readonly random: () => number = Math.random,
  ) {}

  private replay(input: ChargeInput): ChargeDecision | undefined {
    const charge = this.store.find(input.key);
    if (!charge) {
      return undefined;
    }
    if (charge.reference !== input.reference || charge.amount !== input.amount) {
      throw new AppError(409, 'Idempotency-Key đã được dùng cho nội dung khác.');
    }
    return { kind: 'replayed', charge };
  }

  async charge(input: ChargeInput): Promise<ChargeDecision> {
    const cached = this.replay(input);
    if (cached) {
      return cached;
    }
    if (input.amount > 20_000_000) {
      throw new AppError(402, 'Vượt hạn mức 20.000.000đ.');
    }

    if (this.config.delayMs > 0) {
      await sleep(this.config.delayMs, undefined, { signal: this.signal });
    }
    // Request cùng khóa có thể đã hoàn thành trong khi request này chờ.
    const afterDelay = this.replay(input);
    if (afterDelay) {
      return afterDelay;
    }
    if (this.config.failRate > 0 && this.random() < this.config.failRate) {
      throw new AppError(500, 'Ngân hàng tạm lỗi, chưa trừ tiền.');
    }

    // Từ kiểm tra cache tới ghi charge không có await: nguyên tử trong một tiến trình.
    const charge = this.store.create(input);
    return {
      kind: 'created',
      charge,
      dropResponse: this.config.dropRate > 0 && this.random() < this.config.dropRate,
    };
  }
}
