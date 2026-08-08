'use strict';
(() => {
  const state={users:[],filtered:[],selectedId:null,departments:[],permissions:[],currentPermissions:[]};
  const $=s=>document.querySelector(s),toast=$('#toast'),dialog=$('#create-dialog');
  const can=p=>state.currentPermissions.includes(p);
  const show=m=>{toast.textContent=m;toast.classList.add('is-visible');setTimeout(()=>toast.classList.remove('is-visible'),2200)};
  async function api(url,opt={}){const r=await fetch(url,{headers:{'Content-Type':'application/json',Accept:'application/json',...(opt.headers||{})},...opt});const d=await r.json();if(!r.ok)throw new Error(d.message||'Erreur');return d}
  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  function departments(){for(const id of ['#create-department','#edit-department'])$(id).innerHTML=state.departments.map(d=>`<option>${esc(d)}</option>`).join('')}
  function render(){const list=state.filtered;$('#personnel-list').innerHTML=list.map(u=>`<button class="personnel-item ${u.id===state.selectedId?'is-selected':''}" data-id="${u.id}"><img src="${u.avatarUrl||'/assets/logos/abyss-nexus-logo.png'}"><span><strong>${esc(u.username)}</strong><span>${esc(u.matricule)} · ${esc(u.grade)}</span><small>${esc(u.department)}</small></span><span>${esc(u.status)}</span></button>`).join('');document.querySelectorAll('.personnel-item').forEach(b=>b.onclick=()=>select(Number(b.dataset.id)))}
  async function load(){const d=await api('/api/personnel');state.users=d.users;state.filtered=[...d.users];render()}
  function perms(detail){const map=new Map(detail.overrides.map(x=>[x.permission_key,x.effect]));$('#permission-list').innerHTML=state.permissions.map(p=>`<label class="permission-row"><span>${esc(p.label)}</span><select data-permission="${p.key}" ${can('permissions.manage')?'':'disabled'}><option value="inherit" ${!map.has(p.key)?'selected':''}>Automatique</option><option value="allow" ${map.get(p.key)==='allow'?'selected':''}>Autoriser</option><option value="deny" ${map.get(p.key)==='deny'?'selected':''}>Refuser</option></select></label>`).join('')}
  async function select(id){state.selectedId=id;render();const d=await api(`/api/personnel/${id}`),u=d.user;$('#detail-placeholder').hidden=true;$('#detail-content').hidden=false;$('#detail-avatar').src=u.avatarUrl||'/assets/logos/abyss-nexus-logo.png';$('#detail-name').textContent=u.username;$('#detail-matricule').textContent=u.matricule+' · '+u.identifier;$('#detail-status').textContent=u.status;$('#edit-grade').value=u.grade;$('#edit-department').value=u.department;$('#edit-status').value=u.status;$('#edit-signature').value=u.signature||'';$('#edit-force-password').checked=u.forcePasswordChange;perms(d);$('#history-list').innerHTML=d.history.map(h=>`<article class="history-item"><strong>${esc(h.action)}</strong><span>${esc(h.details||'')}</span><small>${esc(h.actorName||'Système')} · ${esc(h.createdAt)}</small></article>`).join('')}
  async function deleteAccount(){
    if(!state.selectedId)return;
    const u=state.users.find(x=>x.id===state.selectedId);
    const label=u?`${u.username} (${u.matricule})`:'ce compte';
    if(!confirm(`Voulez-vous supprimer définitivement ${label} ?\n\nCette action est irréversible.`))return;
    if(prompt(`Tapez SUPPRIMER pour confirmer la suppression définitive de ${label}.`)!=='SUPPRIMER'){
      show('Suppression annulée.');
      return;
    }
    try{
      const d=await api(`/api/personnel/${state.selectedId}`,{method:'DELETE'});
      state.selectedId=null;
      $('#detail-content').hidden=true;
      $('#detail-placeholder').hidden=false;
      $('#detail-placeholder').textContent='Sélectionnez un employé.';
      show(d.message||'Compte supprimé définitivement.');
      await load();
    }catch(err){show(err.message)}
  }
  function installDeleteButton(){
    const section=document.querySelector('.reset-section');
    if(!section||document.querySelector('#delete-account-button'))return;
    const b=document.createElement('button');
    b.id='delete-account-button';
    b.className='danger-action';
    b.type='button';
    b.style.marginTop='14px';
    b.textContent='🗑️ Supprimer définitivement ce compte';
    b.onclick=deleteAccount;
    section.appendChild(b);
  }
  $('#search-input').oninput=e=>{const q=e.target.value.toLowerCase();state.filtered=state.users.filter(u=>[u.username,u.matricule,u.grade,u.department].join(' ').toLowerCase().includes(q));render()};
  $('#open-create').onclick=()=>dialog.showModal();$('#close-create').onclick=()=>dialog.close();
  $('#create-form').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/personnel',{method:'POST',body:JSON.stringify({discordId:$('#create-discord-id').value.trim(),username:$('#create-username').value.trim(),avatarUrl:$('#create-avatar-url').value.trim(),grade:$('#create-grade').value.trim(),department:$('#create-department').value,identifier:$('#create-identifier').value.trim(),password:$('#create-password').value,signature:$('#create-signature').value.trim(),forcePasswordChange:$('#create-force-password').checked,firstLoginNotification:$('#create-first-notification').checked})});dialog.close();e.target.reset();show('Compte créé : '+d.matricule);load()}catch(err){$('#create-message').textContent=err.message}};
  $('#edit-form').onsubmit=async e=>{e.preventDefault();await api(`/api/personnel/${state.selectedId}`,{method:'PATCH',body:JSON.stringify({grade:$('#edit-grade').value.trim(),department:$('#edit-department').value,status:$('#edit-status').value,signature:$('#edit-signature').value.trim(),forcePasswordChange:$('#edit-force-password').checked})});show('Employé mis à jour.');load();select(state.selectedId)};
  $('#save-permissions').onclick=async()=>{const overrides=[...document.querySelectorAll('[data-permission]')].map(s=>({permissionKey:s.dataset.permission,effect:s.value})).filter(x=>x.effect!=='inherit');await api(`/api/personnel/${state.selectedId}/permissions`,{method:'PUT',body:JSON.stringify({overrides})});show('Permissions enregistrées.');select(state.selectedId)};
  $('#reset-password-button').onclick=async()=>{await api(`/api/personnel/${state.selectedId}/reset-password`,{method:'POST',body:JSON.stringify({password:$('#reset-password').value})});$('#reset-password').value='';show('Mot de passe réinitialisé.')};
  (async()=>{const m=await api('/api/personnel/meta');state.departments=m.departments;state.permissions=m.permissions;state.currentPermissions=m.currentPermissions;departments();$('#open-create').hidden=!can('personnel.create');installDeleteButton();const db=$('#delete-account-button');if(db)db.hidden=!can('personnel.edit');await load()})().catch(e=>show(e.message));
})();
