'use strict';
(() => {
  const $=s=>document.querySelector(s),toast=$('#toast');
  const show=m=>{toast.textContent=m;toast.classList.add('is-visible');setTimeout(()=>toast.classList.remove('is-visible'),2200)};
  async function api(url,opt={}){const r=await fetch(url,{headers:{'Content-Type':'application/json',Accept:'application/json',...(opt.headers||{})},...opt});const d=await r.json();if(!r.ok)throw new Error(d.message||'Erreur');return d}
  function fmt(v){return new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v.endsWith?.('Z')?v:v+'Z'))}
  async function load(){const category=$('#notification-category').value;const d=await api('/api/realtime-notifications'+(category?`?category=${encodeURIComponent(category)}`:''));$('#unread-count').textContent=`${d.unreadCount} non lue(s)`;$('#notification-list').innerHTML=d.notifications.map(n=>`<article class="notification-item ${n.readAt?'':'is-unread'}"><strong>${n.title}</strong><span>${n.message}</span><small>${n.type} · ${fmt(n.createdAt)}</small>${n.link?`<a href="${n.link}">Ouvrir</a>`:''}${n.readAt?'':`<button class="secondary-action mark-read" data-id="${n.id}">Marquer comme lue</button>`}</article>`).join('');document.querySelectorAll('.mark-read').forEach(b=>b.onclick=async()=>{await api(`/api/realtime-notifications/${b.dataset.id}/read`,{method:'POST'});load()})}
  $('#notification-category').onchange=()=>load().catch(e=>show(e.message));$('#read-all').onclick=async()=>{const d=await api('/api/realtime-notifications/read-all',{method:'POST'});show(d.message);load()};
  const stream=new EventSource('/api/realtime-notifications/stream');stream.addEventListener('open',()=>{$('#live-status').textContent='● En direct'});stream.addEventListener('error',()=>{$('#live-status').textContent='Reconnexion...'});stream.addEventListener('notification',event=>{const n=JSON.parse(event.data);show(`${n.title} — ${n.message}`);if(Notification.permission==='granted')new Notification(n.title,{body:n.message});load()});
  if('Notification'in window&&Notification.permission==='default')Notification.requestPermission();
  load().catch(e=>show(e.message));
})();