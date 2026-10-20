export type Environment = Readonly<Record<string, string | undefined>>;
export type Logger = (message: string) => void;

export interface IdParams {
  id: string;
}

export interface ErrorBody {
  error: string;
}

export interface PaymentErrorBody extends ErrorBody {
  paymentId: string | null;
  status: 'FAILED';
}
