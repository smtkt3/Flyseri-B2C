import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';import {describe,it,expect} from 'vitest';import type {DatabaseConnection} from '@flyseri/database';
import {FlightPricingService} from './flight-pricing.service.js';
describe('protected pricing policy history',()=>{
 it('keeps immutable revisions, rejects stale writes and restricts publishing to approved staff roles',async()=>{
  const database=new PGlite();try{
   await database.exec('CREATE ROLE flyseri_api; CREATE ROLE anon; CREATE ROLE authenticated;');
   const journal=JSON.parse(readFileSync(resolve('../../packages/database/drizzle/meta/_journal.json'),'utf8'));
   for(const entry of journal.entries)for(const statement of readFileSync(resolve('../../packages/database/drizzle/'+entry.tag+'.sql'),'utf8').split('--> statement-breakpoint').filter((v:string)=>v.trim()))await database.exec(statement);
   const query=(sql:string,args?:unknown[])=>database.query(sql,args);
   const service=new FlightPricingService({pool:{query,connect:async()=>({query,release(){}})}} as unknown as DatabaseConnection);
   expect(await service.policy()).toMatchObject({available:true,revision:0,rules:[]});
   const owner={role:'owner' as const,staffUserId:randomUUID()},manager={role:'manager' as const,staffUserId:randomUUID()};
   await expect(service.save(0,[],{role:'ticketing_staff',staffUserId:randomUUID()},'denied')).rejects.toMatchObject({status:403});
   expect(await service.save(0,[],owner,'first')).toMatchObject({revision:1});
   expect(await service.save(1,[],manager,'second')).toMatchObject({revision:2});
   await expect(service.save(1,[],owner,'stale')).rejects.toMatchObject({status:409});
   expect((await query('SELECT revision FROM flight_pricing_policies ORDER BY revision')).rows).toEqual([{revision:1},{revision:2}]);
   expect((await query("SELECT count(*)::int AS n FROM admin_audit_events WHERE event='flight.pricing.published'")).rows).toEqual([{n:2}]);
   expect((await query("SELECT has_table_privilege('anon','flight_pricing_policies','SELECT') AS anon,has_table_privilege('authenticated','flight_pricing_policies','SELECT') AS customer,has_table_privilege('flyseri_api','flight_pricing_policies','UPDATE') AS update_allowed")).rows).toEqual([{anon:false,customer:false,update_allowed:false}]);
  }finally{await database.close();}
 },30000);
});
