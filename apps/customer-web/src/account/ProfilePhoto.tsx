import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { authService } from '../services/authService';
import { documentService } from '../services/documentService';

export function profilePhotoId(metadata:Record<string,unknown>|undefined):string|null {
  const id=metadata?.flyseri_photo_document_id;
  return typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)?id:null;
}
export function useProfilePhoto() {
  const {session}=useAuth();
  const id=profilePhotoId(session?.user?.user_metadata);
  const [url,setUrl]=useState('');
  useEffect(()=>{
    let active=true; let timer:ReturnType<typeof setTimeout>|undefined;
    setUrl('');
    async function refresh() {
      if(!id)return;
      try { const access=await documentService.access(id); if(active){setUrl(access.url);timer=setTimeout(()=>void refresh(),Math.max(5,access.expiresInSeconds-30)*1000);} }
      catch { if(active)setUrl(''); }
    }
    void refresh(); return()=>{active=false;clearTimeout(timer);};
  },[id]);
  return {id,url};
}

export async function prepareProfilePhoto(file:File):Promise<File> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size===0||file.size>5*1024*1024) throw new Error('Choose a JPG, PNG or WebP image up to 5 MB.');
  const objectUrl=URL.createObjectURL(file);
  try {
    const image=new Image();
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('This image could not be opened. Choose another photo.'));image.src=objectUrl;});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40_000_000) throw new Error('Choose a smaller image, up to 40 megapixels.');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const context=canvas.getContext('2d');if(!context)throw new Error('Photo editing is unavailable in this browser.');
    const side=Math.min(image.naturalWidth,image.naturalHeight);
    context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,256,256);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not prepare this photo.')),'image/jpeg',.85));
    return new File([blob],'flyseri-profile.jpg',{type:'image/jpeg'});
  } finally {URL.revokeObjectURL(objectUrl);}
}

export function ProfilePhoto({name}:{name:string}) {
  const {id,url}=useProfilePhoto();
  const [preview,setPreview]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const pending=useRef<{id:string;key:string}|null>(null);
  const lock=useRef(false);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!file){setPreview('');return;}const next=URL.createObjectURL(file);setPreview(next);return()=>URL.revokeObjectURL(next);},[file]);
  async function choose(next:File|undefined) {
    if(!next||lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try {setFile(await prepareProfilePhoto(next));if(pending.current)pending.current.key=crypto.randomUUID();}
    catch(cause){setError(cause instanceof Error?cause.message:'Choose another photo.');}
    finally{lock.current=false;setBusy(false);if(input.current)input.current.value='';}
  }
  async function save(remove=false) {
    if(lock.current||(!remove&&!file))return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try {
      let nextId:string|null=null;
      if(!remove&&file){
        if(!pending.current) pending.current={id:(await documentService.create({documentType:'OTHER',displayName:'Profile photo'})).id,key:crypto.randomUUID()};
        await documentService.upload(pending.current.id,file,pending.current.key);
        nextId=pending.current.id;
      }
      await authService.updateProfilePhoto(nextId);
      // The reference is only an identifier. The document API checks ownership and issues a private, short-lived URL.
      pending.current=null;setFile(null);setNotice(remove?'Profile photo removed.':'Profile photo saved.');
      if(id&&id!==nextId) {try{await documentService.archive(id);}catch{setNotice('Photo updated. Your previous photo remains in Documents, where you can remove it.');}}
    } catch {setError('We could not save your photo. Try again; your selection has been kept.');}
    finally{lock.current=false;setBusy(false);}
  }
  return <section className="profile-photo-card" aria-label="Profile photo"><div className="profile-photo-avatar">{preview||url?<img key={preview||url} src={preview||url} alt="Your profile" onError={event=>{event.currentTarget.style.display='none';}}/>:<span aria-hidden="true">{name[0]?.toUpperCase()||'F'}</span>}</div><div><h2>Your profile photo</h2><p>JPG, PNG or WebP, up to 5 MB. Your photo is cropped to a square.</p><div className="profile-photo-actions"><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile photo" disabled={busy} onChange={event=>void choose(event.target.files?.[0])}/><button className="account-outline-button" disabled={busy} type="button" onClick={()=>input.current?.click()}>Change photo</button>{file&&<button className="btn-primary" type="button" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save photo'}</button>}{id&&!file&&<button className="account-link" type="button" disabled={busy} onClick={()=>void save(true)}>Remove photo</button>}</div>{file&&<small>Preview only until you save. The photo is stored privately with your account.</small>}{busy&&<p role="status">Preparing or saving your photo…</p>}{error&&<p role="alert" className="account-error">{error}</p>}{notice&&<p role="status" className="account-notice">{notice}</p>}</div></section>;
}
