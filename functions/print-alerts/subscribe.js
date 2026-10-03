const ORIGINS = new Set(['https://signalshieldsolutions.com', 'https://www.signalshieldsolutions.com']);
const reply = (status, message) => Response.json({message}, {status, headers:{'Cache-Control':'no-store'}});
const success = () => reply(200, 'Check your inbox and confirm your email to receive live-print alerts.');

async function fingerprint(value, secret){
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret + ':' + value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
}

export async function onRequest({request, env}){
  if(request.method !== 'POST') return reply(405, 'Please use the signup form.');
  if(!ORIGINS.has(request.headers.get('Origin'))) return reply(403, 'Please use the signup form on our website.');
  if(!env.BREVO_API_KEY || !env.LIVE_ALERT_LIMITS || !env.BREVO_ALERT_LIST_ID || !env.BREVO_DOI_TEMPLATE_ID){
    return reply(503, 'Email signup is temporarily unavailable. Please try again later.');
  }
  if(!request.headers.get('Content-Type')?.includes('application/json')) return reply(415, 'Invalid submission.');
  if(Number(request.headers.get('Content-Length')) > 2048) return reply(413, 'Invalid submission.');
  let data;
  try{
    const reader = request.body.getReader();
    let size = 0, body = '';
    const decoder = new TextDecoder();
    for(;;){
      const {done,value} = await reader.read();
      if(done) break;
      size += value.byteLength;
      if(size > 2048){ await reader.cancel(); return reply(413,'Invalid submission.'); }
      body += decoder.decode(value,{stream:true});
    }
    data = JSON.parse(body + decoder.decode());
  }catch{return reply(400, 'Please enter a valid email address.');}
  if(!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, 'Invalid submission.');
  if(data.website) return success(); // Honeypot: do not send mail.
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if(email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || data.consent !== true){
    return reply(400, 'Enter your email and agree to receive live-print alerts.');
  }
  try{
    // Best-effort cooldowns; keys expire and contain no plain email or IP address.
    const emailKey = 'email:' + await fingerprint(email, env.BREVO_API_KEY);
    const ipKey = 'ip:' + await fingerprint(request.headers.get('CF-Connecting-IP') || 'unknown', env.BREVO_API_KEY);
    if(await env.LIVE_ALERT_LIMITS.get(emailKey)) return success();
    if(await env.LIVE_ALERT_LIMITS.get(ipKey)) return reply(429, 'Please wait a minute before trying again.');
    await env.LIVE_ALERT_LIMITS.put(ipKey,'1',{expirationTtl:60});
    const response = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation',{
      method:'POST', headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email,includeListIds:[Number(env.BREVO_ALERT_LIST_ID)],
        templateId:Number(env.BREVO_DOI_TEMPLATE_ID),
        redirectionUrl:'https://signalshieldsolutions.com/live-prints?alerts=confirmed#liveAlertSignup'}),
      signal:AbortSignal.timeout(12000)
    });
    if(!response.ok) return reply(503,'We could not send the confirmation email. Please try again later.');
    await env.LIVE_ALERT_LIMITS.put(emailKey,'1',{expirationTtl:900});
    return success();
  }catch{return reply(503,'Email signup is temporarily unavailable. Please try again later.');}
}
