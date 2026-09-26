import {env} from "cloudflare:workers";
export function db():D1Database{if(!env.DB)throw new Error("Database unavailable");return env.DB}
export async function all<T=Record<string,any>>(sql:string,...values:any[]):Promise<T[]>{return (await db().prepare(sql).bind(...values).all<T>()).results}
export async function one<T=Record<string,any>>(sql:string,...values:any[]):Promise<T|null>{return db().prepare(sql).bind(...values).first<T>()}
export async function run(sql:string,...values:any[]){return db().prepare(sql).bind(...values).run()}
export async function secret(key:string,make:()=>Promise<string>):Promise<string>{let row=await one("SELECT value FROM app_secrets WHERE key=?",key);if(row)return row.value;await run("INSERT OR IGNORE INTO app_secrets(key,value) VALUES (?,?)",key,await make());return (await one("SELECT value FROM app_secrets WHERE key=?",key))!.value}
