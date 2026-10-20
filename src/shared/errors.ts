import type { ErrorRequestHandler, Express } from 'express';
import type { ErrorBody, PaymentErrorBody } from './types.js';
import { isRecord } from './validation.js';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly paymentId: string | null = null,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Đảm bảo cả lỗi JSON/body-parser lẫn lỗi nghiệp vụ đều trả JSON. */
export function jsonErrors(app: Express, { payment = false } = {}): void {
  const body = (error: string, paymentId: string | null = null): ErrorBody | PaymentErrorBody =>
    payment ? { error, paymentId, status: 'FAILED' } : { error };

  app.use((_req, res) => {
    res.status(404).json(body('Không tìm thấy endpoint.'));
  });

  const handler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof AppError) {
      res.status(error.statusCode).json(body(error.message, error.paymentId));
      return;
    }
    if (isRecord(error) && error.type === 'entity.parse.failed') {
      res.status(400).json(body('Body phải là JSON hợp lệ.'));
      return;
    }
    if (isRecord(error) && error.type === 'entity.too.large') {
      res.status(413).json(body('Body vượt giới hạn 16 KB.'));
      return;
    }
    // Không trả stack trace hoặc nội dung lỗi hệ thống cho client.
    console.error('[http] Lỗi chưa được xử lý:', error);
    res.status(500).json(body('Lỗi nội bộ service.'));
  };
  app.use(handler);
}
