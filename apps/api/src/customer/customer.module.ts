import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerAuthGuard, OptionalCustomerAuthGuard } from './auth.js';
import { CustomerRateLimitGuard } from './rate-limit.guard.js';
import {PassportVaultService} from './passport-vault.service.js';

@Module({ controllers: [CustomerController], providers: [CustomerService, PassportVaultService, CustomerAuthGuard, OptionalCustomerAuthGuard, CustomerRateLimitGuard], exports: [CustomerService, CustomerAuthGuard, OptionalCustomerAuthGuard, CustomerRateLimitGuard] })
export class CustomerModule {}
