import {getChatGPTUser} from "@/app/chatgpt-auth";
import {one,run,secret} from "./db";
export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export const fail=(code:number,msg:string):never=>{throw new HttpError(code,msg)};
export async function identity(){return getChatGPTUser()}
export async function member(){const a=await identity();if(!a)fail(401,"로그인이 필요합니다.");const u=await one("SELECT * FROM users WHERE id=?",a!.userId);if(!u)fail(403,"먼저 내 삐삐 번호를 발급해 주세요.");return u!}
export async function hash(value:string){const salt=await secret("rate_salt",async()=>crypto.randomUUID()+crypto.randomUUID());const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(salt+value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("")}
export async function ipKey(req:Request){return hash(req.headers.get("cf-connecting-ip")||"local-shared")}
export async function limit(key:string,max:number,seconds:number){const now=Date.now(),window=Math.floor(now/(seconds*1000));const row=await one("INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",`${key}:${window}`,now+seconds*1000);if((row?.count||0)>max)fail(429,"호출이 너무 잦습니다. 잠시 후 다시 시도해 주세요.")}
export function sameOrigin(req:Request){const origin=req.headers.get("origin");if(!origin||origin!==new URL(req.url).origin)fail(403,"허용되지 않은 요청입니다.");if(!req.headers.get("content-type")?.startsWith("application/json"))fail(415,"JSON 요청이 필요합니다.")}
export async function body(req:Request){if(Number(req.headers.get("content-length")||0)>8192)fail(413,"입력 내용이 너무 깁니다.");const reader=req.body?.getReader();if(!reader)return {};let total=0,parts:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>8192){await reader.cancel();fail(413,"입력 내용이 너무 깁니다.")}parts.push(value)}try{const buf=new Uint8Array(total);let offset=0;for(const p of parts){buf.set(p,offset);offset+=p.length}const v=JSON.parse(new TextDecoder().decode(buf));if(!v||Array.isArray(v)||typeof v!=="object")throw 0;return v}catch{fail(400,"입력 형식이 올바르지 않습니다.")}}
export function str(v:unknown,min:number,max:number,label:string){if(typeof v!=="string"||v.trim().length<min||v.trim().length>max)fail(400,`${label}을(를) ${min}~${max}자로 입력해 주세요.`);return (v as string).trim()}
export function digits(v:unknown,min:number,max:number,label:string){const n=str(v,min,max,label);if(!/^\d+$/.test(n))fail(400,`${label}에는 숫자만 입력해 주세요.`);return n}
export function pager(v:unknown){const n=typeof v==="string"?v.replace(/[-\s]/g,""):"";if(!/^015\d{8}$/.test(n))fail(400,"015로 시작하는 11자리 삐삐 번호를 입력해 주세요.");return n}
export async function cleanup(){await run("DELETE FROM rate_limits WHERE expires_at<?",Date.now()-3600000)}
