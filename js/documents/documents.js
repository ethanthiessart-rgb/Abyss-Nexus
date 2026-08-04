'use strict';
(() => {
  const state={documents:[],departments:[],canManage:false};
  const $=s=>document.querySelector(s),dialog=$('#document-dialog'),toast=$('#toast');
  const show=m=>{toast.textContent=m;toast.classList.add('is-visible');setTimeout(()=>toast.classList.remove('is-visible'),2200)};
  async function json(url,opt={}){const r=await fetch(url,{headers:{Accept:'application/json',...(opt.headers||{})},...opt});const d=await r.json();if(!r.ok)throw new Error(d.message||'Erreur');return d}
  function size(n){if(n<1024)return n+' o';if(n<1048576)return (n/1024).toFixed(1)+' Ko';return (n/1048576).toFixed(1)+' Mo'}
  function render(list){$('#document-list').innerHTML=list.map(d=>`<article class="document-card"><span>📄 ${d.folder}</span><h3>${d.title}</h3><p>${d.description||d.originalName}</p><p>${size(d.sizeBytes)} · v${d.version} · ${d.uploaderName}</p><div class="document-actions"><a href="/api/documents/${d.id}/download">Télécharger</a>${state.canManage?`<button class="archive-document" data-id="${d.id}">Archiver</button>`:''}</div></article>`).join('');$('#document-empty').hidden=list.length>0;document.querySelectorAll('.archive-document').forEach(b=>b.onclick=async()=>{await json(`/api/documents/${b.dataset.id}/archive`,{method:'POST'});show('Document archivé.');load()})}
  async function load(){const d=await json('/api/documents');state.documents=d.documents;render(state.documents)}
  async function init(){const m=await json('/api/documents/meta');state.departments=m.departments;state.canManage=m.canManage;$('#upload-document').hidden=!state.canManage;$('#document-departments').innerHTML='<legend>Départements autorisés</legend>'+state.departments.map(d=>`<label class="checkbox-row"><input type="checkbox" value="${d}">${d}</label>`).join('');await load()}
  $('#document-search').oninput=e=>{const q=e.target.value.toLowerCase();render(state.documents.filter(d=>[d.title,d.description,d.folder,d.originalName].join(' ').toLowerCase().includes(q)))};
  $('#upload-document').onclick=()=>dialog.showModal();$('#close-document').onclick=()=>dialog.close();$('#document-global').onchange=()=>{$('#document-departments').hidden=$('#document-global').checked};
  $('#document-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData();fd.append('file',$('#document-file').files[0]);fd.append('title',$('#document-title').value.trim());fd.append('description',$('#document-description').value.trim());fd.append('folder',$('#document-folder').value.trim());fd.append('globalVisible',String($('#document-global').checked));fd.append('departments',JSON.stringify([...document.querySelectorAll('#document-departments input:checked')].map(i=>i.value)));try{const r=await fetch('/api/documents',{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.message);dialog.close();e.target.reset();show(d.message);load()}catch(err){$('#document-message').textContent=err.message}};
  init().catch(e=>show(e.message));
})();
