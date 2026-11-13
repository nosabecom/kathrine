import { useEffect, useState } from 'react';
import { api, post } from './api';

type Status={configured:boolean;automatic:boolean;running:boolean;checked:number;downloaded:number;unmatched:number;errors:number;lastError:string;cooldownUntil:number};
type Audit={total:number;missingEnglish:number;browserNeedsText:number;accuracyVerified:false;items:{id:string;title:string;series?:string;season?:number;episode?:number;needsEnglish:boolean;browserNeedsText:boolean;downloaded:boolean;error?:string}[]};
export function SubtitleSettings() {
  const [status,setStatus]=useState<Status|null>(null),[audit,setAudit]=useState<Audit|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=async()=>setStatus(await api<Status>('/api/subtitles/status'));
  useEffect(()=>{let active=true;const update=async()=>{try{const s=await api<Status>('/api/subtitles/status');if(active)setStatus(s);}catch(e){if(active)setError((e as Error).message);}};void update();const timer=setInterval(()=>void update(),10_000);return()=>{active=false;clearInterval(timer);};},[]);
  const action=async(work:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await work();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <section className="settings-card"><div className="settings-heading"><div><h2>Subtitles</h2><p>English subtitles matched to your episode and release, stored separately from the video.</p></div></div>
    <p>{status?.configured?`SubDL configured · Automatic sourcing ${status.automatic?'on':'off'}`:'SubDL is not configured. Add KATHRINE_SUBDL_API_KEY to the server environment when you are ready to release this update.'}</p>
    <p className="subtle">Original tracks stay available. A release match does not verify every word or timing. New files become selectable the next time you open a title.</p>
    <div className="button-row"><button disabled={busy} onClick={()=>void action(async()=>setAudit(await api<Audit>('/api/subtitles/audit')))}>Audit subtitles</button><button disabled={busy||!status?.configured||status.running} onClick={()=>void action(()=>post('/api/subtitles/run'))}>{status?.running?'Searching…':'Find English subtitles'}</button></div>
    {status&&!!status.checked&&<p>Last search: {status.checked} checked · {status.downloaded} downloaded · {status.unmatched} without a safe match · {status.errors} errors</p>}
    {!!status?.cooldownUntil&&status.cooldownUntil>Date.now()&&<p>Provider cooldown until {new Date(status.cooldownUntil).toLocaleString()}.</p>}
    {(error||status?.lastError)&&<p role="alert">{error||status?.lastError}</p>}
    {audit&&<><p>{audit.total} titles checked · {audit.missingEnglish} missing English · {audit.browserNeedsText} need text subtitles for browser playback.</p><p className="subtle">This checks track coverage and file access. Dialogue accuracy and synchronization have not been verified.</p><details><summary>Titles needing attention</summary>{audit.items.filter(item=>item.needsEnglish||item.browserNeedsText||item.error).map(item=><div className="library-row" key={item.id}><div><strong>{item.series?`${item.series} S${item.season}E${item.episode} · `:''}{item.title}</strong><p>{item.error|| (item.needsEnglish?'No English subtitles':'English is available only as images')}</p></div>{status?.configured&&<button disabled={busy||status.running} onClick={()=>void action(()=>post(`/api/media/${item.id}/subtitles/fetch`))}>Find English</button>}</div>)}</details></>}
  </section>;
}
