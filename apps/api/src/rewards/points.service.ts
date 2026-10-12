import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseConnection } from '@flyseri/database';
import { DATABASE_CONNECTION } from '../tokens.js';
import { ApiException } from '../api-exception.js';
import { PointsRepository } from './points.repository.js';

@Injectable()
export class PointsService {
  private readonly repository: PointsRepository | undefined;
  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection | undefined) {
    this.repository=connection ? new PointsRepository(connection.pool):undefined;
  }
  // The platform currently has only CERT flights and a Stripe test adapter.
  // A future verified live adapter must explicitly enable real redemption here.
  readonly redemptionEnabled=false;
  private get store() { if(!this.repository)throw new ApiException('DEPENDENCY_UNAVAILABLE','Flyseri Points are temporarily unavailable. Please try again.',503);return this.repository; }
  wallet(customerId:string,page:number) {return this.store.wallet(customerId,page);}
  quote(customerId:string,orderId:string) {return this.store.quote(customerId,orderId,this.redemptionEnabled);}
  async apply(customerId:string,orderId:string,points:number) {
    await this.store.apply(customerId,orderId,points,this.redemptionEnabled);
    return this.quote(customerId,orderId);
  }
  verify(customerId:string,orderId:string,completedAt:string,staffId:string,evidence:string) {return this.store.verifyJourney(customerId,orderId,completedAt,staffId,evidence);}
  refund(customerId:string,orderId:string,amount:string,staffId:string,evidence:string) {return this.store.refund(customerId,orderId,amount,staffId,evidence);}
  adjust(customerId:string,points:number,key:string,staffId:string,evidence:string) {return this.store.adjust(customerId,points,key,staffId,evidence);}
}
