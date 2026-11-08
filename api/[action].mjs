import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
const ids=JSON.parse(readFileSync(new URL('../vercel-counter/candidates.json',import.meta.url),'utf8'));
const allowed=new Set(ids);
const prefix='taipei-council:v1:';
export const config={api:{bodyParser:{sizeLimit:'2kb'}}};
// Redis executes this entire script atomically, including deduplication and limits.
export const incrementScript=`
local rate=redis.call('INCR',KEYS[3])
if rate==1 then redis.call('EXPIRE',KEYS[3],7200) end
if rate>240 then return {'RATE_LIMITED'} end
local kind=ARGV[1]
local visitor=ARGV[2]
for i=3,#ARGV do
 local id=ARGV[i]
 local seen=visitor..':'..kind..':'..id
 if redis.call('HSETNX',KEYS[2],seen,1)==1 then
  redis.call('HINCRBY',KEYS[1],id..':'..kind,1)
 end
end
redis.call('EXPIRE',KEYS[2],172800)
return redis.call('HGETALL',KEYS[1])
`;
export function snapshot(result){
 const counts=Object.fromEntries(ids.map(id=>[id,{view:0,compare:0}]));
 for(let i=0;i<result.length;i+=2){
  const [id,kind]=String(result[i]).split(':');const n=Number(result[i+1]);
  if(counts[id]&&['view','compare'].includes(kind)&&Number.isSafeInteger(n)&&n>=0)counts[id][kind]=n;
 }
 return counts;
}
export function validEvent(data){
 return data&&['view','compare'].includes(data.kind)&&Array.isArray(data.ids)&&data.ids.length>=1&&data.ids.length<=3&&data.ids.every(id=>allowed.has(id))&&new Set(data.ids).size===data.ids.length&&(data.kind!=='compare'||data.ids.length>=2)&&typeof data.visitor==='string'&&/^[a-f0-9-]{36}$/.test(data.visitor);
}
export default async function handler(req,res){
 const origin=process.env.ALLOWED_ORIGIN||'https://taipei-council-ten.vercel.app';
 res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.headers.origin===origin)res.setHeader('Access-Control-Allow-Origin',origin);
 const reply=(status,body)=>res.status(status).json(body);
 const action=req.query.action;
 if(!['counts','events'].includes(action))return reply(404,{error:'Not found'});
 if(req.method==='OPTIONS'){
  if(req.headers.origin!==origin)return reply(403,{error:'Origin denied'});
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Max-Age','600');return res.status(204).end();
 }
 if(!((action==='counts'&&req.method==='GET')||(action==='events'&&req.method==='POST')))return reply(405,{error:'Method not allowed'});
 const redisUrl=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL;
 const redisToken=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
 if(!redisUrl||!redisToken)return reply(503,{error:'Database not configured'});
 async function redis(command){
  const response=await fetch(redisUrl,{method:'POST',headers:{Authorization:`Bearer ${redisToken}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw Error('Database unavailable');const data=await response.json();
  if(data.error||!Array.isArray(data.result))throw Error('Invalid database response');return data.result;
 }
 try{
  if(action==='counts')return reply(200,{counts:snapshot(await redis(['HGETALL',prefix+'counts']))});
  if(req.headers.origin!==origin)return reply(403,{error:'Origin denied'});
  if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))return reply(415,{error:'JSON required'});
  let data=req.body;
  if(Buffer.isBuffer(data))data=data.toString('utf8');
  if(typeof data==='string'){if(Buffer.byteLength(data)>2048)return reply(413,{error:'Too large'});try{data=JSON.parse(data)}catch{return reply(400,{error:'Invalid JSON'})}}
  if(Buffer.byteLength(JSON.stringify(data)||'')>2048)return reply(413,{error:'Too large'});
  if(!validEvent(data))return reply(400,{error:'Invalid event'});
  // Vercel overwrites this header at its edge; do not trust client-supplied X-Forwarded-For.
  const ip=req.headers['x-vercel-forwarded-for'];
  if(typeof ip!=='string'||!ip.trim())return reply(503,{error:'Service not configured'});
  const now=Date.now();const day=new Date(now+8*3600000).toISOString().slice(0,10);const hour=Math.floor(now/3600000);
  const hash=value=>createHmac('sha256',process.env.HASH_SECRET||redisToken).update(value).digest('hex');
  const result=await redis(['EVAL',incrementScript,3,prefix+'counts',prefix+'seen:'+day,prefix+'rate:'+hour+':'+hash(day+':'+ip),data.kind,hash(day+':'+data.visitor),...data.ids]);
  if(result[0]==='RATE_LIMITED'){res.setHeader('Retry-After','3600');return reply(429,{error:'Rate limited'})}
  return reply(200,{counts:snapshot(result)});
 }catch{return reply(503,{error:'Counter unavailable'})}
}
