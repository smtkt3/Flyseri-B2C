import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { COMMERCE_REPOSITORY } from '../tokens.js';
import { CommerceRepository } from './commerce.repository.js';
import { PaymentEngineService } from './payment-engine.service.js';

/** Bounded sandbox polling also covers customers who do not return from Stripe Checkout. */
@Injectable()
export class PaymentReconciliationPoller implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(@Inject(COMMERCE_REPOSITORY) private readonly repository: CommerceRepository | undefined,
    @Inject(PaymentEngineService) private readonly engine: PaymentEngineService) {}

  onModuleInit(): void {
    if (!this.repository || !this.engine.available()) return;
    this.timer = setInterval(() => { void this.runOnce().catch(() => { /* Retry the batch at the next interval. */ }); }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    const providerId = this.engine.providerId();
    if (!this.repository || !providerId || this.running) return;
    this.running = true;
    try {
      for (const id of await this.repository.reconciliationCandidateIds(providerId, 20)) {
        try { await this.engine.reconcile(id); }
        catch { await this.repository.reconciliationChecked(id); }
      }
    } finally { this.running = false; }
  }
}
