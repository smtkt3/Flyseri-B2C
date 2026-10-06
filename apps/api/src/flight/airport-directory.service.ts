import {Injectable,type OnModuleInit} from '@nestjs/common';
import {readFile} from 'node:fs/promises';
import type {AirportDirectoryEntry} from '@flyseri/types';
import {ApiException} from '../api-exception.js';

type AirportSource=Omit<AirportDirectoryEntry,'countryName'|'cityLabel'>;
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const popularCodes=['KUL','PEN','SIN','BKK','HND','NRT','KIX','ICN','DXB','LHR'];
@Injectable()
export class AirportDirectoryService implements OnModuleInit {
  private directory:Promise<(AirportDirectoryEntry&{searchText:string})[]>|undefined;
  onModuleInit(){void this.load().catch(()=>undefined);}
  private load(){
    return this.directory??=readFile(new URL('../../assets/airports.json',import.meta.url),'utf8').then(bytes=>{
      const names=new Intl.DisplayNames(['en'],{type:'region'});
      return (JSON.parse(bytes) as AirportSource[]).map(airport=>{
        const countryName=names.of(airport.country)??airport.country;
        const cityLabel=airport.cityCenterName||(airport.city||airport.name).replace(/ \(.+$/,'');
        return {...airport,countryName,cityLabel,searchText:normalize(`${airport.code} ${airport.city} ${cityLabel} ${airport.name} ${countryName} ${airport.keywords}`)};
      });
    }).catch(()=>{this.directory=undefined;throw new ApiException('DEPENDENCY_UNAVAILABLE','Airport suggestions are unavailable.',503);});
  }
  async suggestions(query:string):Promise<AirportDirectoryEntry[]>{
    const airports=await this.load();const terms=normalize(query).split(/\s+/).filter(Boolean);
    let matches:typeof airports;
    if(!terms.length)matches=popularCodes.flatMap(code=>airports.filter(airport=>airport.code===code));
    else {
      const exact=terms.length===1&&/^[a-z]{3}$/.test(terms[0]!)?airports.find(airport=>normalize(airport.code)===terms[0]):undefined;
      if(exact)matches=[exact];
      else {
        const rank=(airport:AirportDirectoryEntry)=>{
          const code=normalize(airport.code),city=normalize(airport.city),name=normalize(airport.name);
          if(code===terms[0])return 0;if(code.startsWith(terms[0]!))return 1;
          if(city===terms[0])return airport.scheduled?2:5;if(city.startsWith(terms[0]!))return airport.scheduled?3:6;
          if(name.startsWith(terms[0]!))return airport.scheduled?4:7;return airport.scheduled?8:9;
        };
        const size=(airport:AirportDirectoryEntry)=>airport.type==='large_airport'?0:airport.type==='medium_airport'?1:2;
        matches=airports.filter(airport=>terms.every(term=>airport.searchText.includes(term))).sort((a,b)=>rank(a)-rank(b)||size(a)-size(b)||a.city.localeCompare(b.city)||a.name.localeCompare(b.name)).slice(0,12);
      }
    }
    return matches.map(({searchText:_index,...airport})=>airport);
  }
  async details(codes:string[]){
    const wanted=new Set(codes);const airports=await this.load();
    return Object.fromEntries(airports.filter(airport=>wanted.has(airport.code)).map(airport=>[airport.code,{city:airport.cityLabel,name:airport.name}]));
  }
}
