import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@flyseri/types';

export class ApiException extends HttpException {
  constructor(readonly code: ApiErrorCode, message: string, status: number) {
    super(message, status);
  }
}
