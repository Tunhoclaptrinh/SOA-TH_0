import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.js';
import { isPositiveMoney } from '../shared/validation.js';
import type { FeesResponse, Payment, PaymentOutcome, StudentAccount } from './types.js';

export class FeeStore {
  private readonly students = new Map<string, StudentAccount>([
    ['1', { outstanding: 50_000_000, reserved: 0 }],
    ['2', { outstanding: 0, reserved: 0 }],
    ['3', { outstanding: 3_200_000, reserved: 0 }],
  ]);
  private readonly payments = new Map<string, Payment>();
  private readonly session = randomUUID();
  private sequence = 0;

  private student(id: string): StudentAccount {
    const student = this.students.get(id);
    if (!student) {
      throw new AppError(404, 'Không tìm thấy sinh viên.');
    }
    return student;
  }

  fees(id: string): FeesResponse {
    const student = this.student(id);
    return { studentId: id, ...student, available: student.outstanding - student.reserved };
  }

  payment(id: string): Payment {
    const payment = this.payments.get(id);
    if (!payment) {
      throw new AppError(404, 'Không tìm thấy lệnh thanh toán.');
    }
    return payment;
  }

  create(studentId: string, amount: unknown): Payment {
    const student = this.student(studentId);
    if (!isPositiveMoney(amount)) {
      throw new AppError(400, 'amount phải là số nguyên dương (VND).');
    }
    if (amount > student.outstanding - student.reserved) {
      throw new AppError(400, 'Số tiền vượt công nợ khả dụng (đã trừ phần đang chờ xác nhận).');
    }
    const id = `P${++this.sequence}`;
    const payment: Payment = {
      id,
      key: `${this.session}:${id}`,
      studentId,
      amount,
      everUncertain: false,
      outcome: {
        status: 'PENDING',
        httpStatus: 504,
        attempts: 0,
        error: 'Đang chờ ngân hàng xác nhận.',
      },
    };
    // Giữ chỗ đồng bộ trước await: các thanh toán đồng thời không vượt tổng công nợ.
    student.reserved += amount;
    this.payments.set(id, payment);
    return payment;
  }

  settle(payment: Payment, outcome: PaymentOutcome): void {
    if (payment.outcome.status !== 'PENDING') {
      throw new Error('Không được cập nhật lệnh đã kết thúc.');
    }
    const student = this.student(payment.studentId);
    switch (outcome.status) {
      case 'PAID':
        student.outstanding -= payment.amount;
        student.reserved -= payment.amount;
        break;
      case 'FAILED':
        student.reserved -= payment.amount;
        break;
      case 'PENDING':
        payment.everUncertain = true;
        break;
    }
    payment.outcome = outcome;
  }
}
