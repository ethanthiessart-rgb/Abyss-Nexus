'use strict';
(() => {
  const state={items:[]};const $=s=>document.querySelector(s),toast=$('#toast');
  const show=m=>{toast.textContent=m;toast.classList.add('is-visible');setTimeout(()=>toast.classList.remove('is-visible'),2200)};
  async function api(){const type=$('#archive-filter').value;const r=await fetch(`/api/archives?type=${encodeURIComponent(type)}`,{headers:{Accept:'application/json'}});const d=await r.json();if(!r.ok)throw new Error(d.message||'Erreur');return d}
  function fmt(v){return new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v.endsWith?.('Z')?v:v+'Z'))}
  const icons={announcement:'📢',document:'📁',report:'📄',sanction:'⚖️',personnel:'👤'};
  function render(){const q=$('#archive-search').value.toLowerCase();const list=state.items.filter(x=>[x.title,x.subtitle,x.type].join(' ').toLowerCase().includes(q));$('#archive-list').innerHTML=list.map(x=>`<article class="archive-item"><span class="archive-icon">${icons[x.type]||'🗄️'}</span><div><strong>${x.title}</strong><span>${x.subtitle}</span></div><small>${fmt(x.archivedAt)}</small></article>`).join('');$('#archive-empty').hidden=list.length>0}
  async function load(){const d=await api();state.items=d.items;render()}
  $('#archive-filter').onchange=()=>load().catch(e=>show(e.message));$('#archive-search').oninput=render;load().catch(e=>show(e.message));
})();