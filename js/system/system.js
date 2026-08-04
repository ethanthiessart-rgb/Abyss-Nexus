'use strict';
(() => {
  const $=s=>document.querySelector(s),toast=$('#toast');
  const show=m=>{toast.textContent=m;toast.classList.add('is-visible');setTimeout(()=>toast.classList.remove('is-visible'),2200)};
  async function api(){const r=await fetch('/api/system-center',{headers:{Accept:'application/json'}});const d=await r.json();if(!r.ok)throw new Error(d.message||'Erreur');return d}
  function bytes(n){if(n<1024)return n+' o';if(n<1048576)return(n/1024).toFixed(1)+' Ko';if(n<1073741824)return(n/1048576).toFixed(1)+' Mo';return(n/1073741824).toFixed(2)+' Go'}
  function dl(items){return Object.entries(items).map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}
  async function load(){const d=await api();$('#service-data').innerHTML=dl({'Node.js':d.service.nodeVersion,'Plateforme':d.service.platform,'Processus':d.service.processUptime,'Système':d.service.systemUptime,'PID':d.service.pid});$('#memory-bar').style.width=d.memory.usagePercent+'%';$('#memory-label').textContent=`${d.memory.usagePercent}% — ${d.memory.usedSystemMb} / ${d.memory.totalSystemMb} Mo`;$('#process-memory').textContent=`Abyss Nexus utilise ${d.memory.processMb} Mo`;$('#storage-data').innerHTML=dl({'Base SQLite':bytes(d.storage.databaseBytes),'Documents importés':bytes(d.storage.uploadsBytes)});$('#database-data').innerHTML=dl({'Utilisateurs':d.counts.users,'Journaux':d.counts.audit,'Notifications':d.counts.notifications,'Dernière mesure':new Date(d.timestamp).toLocaleString('fr-FR')})}
  $('#refresh-system').onclick=()=>load().catch(e=>show(e.message));load().catch(e=>show(e.message));
})();