'use strict';
const {getDatabaseHelpers}=require('./database');
const {PERMISSIONS,getDefaultPermissions,getEffectivePermissions,requirePermission}=require('./permissions');

function registerPermissionCenterRoutes(app){
  app.get('/api/permission-center/meta',requirePermission('permissions.manage'),(_req,res)=>{
    res.json({ok:true,permissions:PERMISSIONS});
  });

  app.get('/api/permission-center/users',requirePermission('permissions.manage'),(_req,res)=>{
    const {all}=getDatabaseHelpers();
    const users=all(`SELECT id,discord_username,avatar_url,matricule,grade,department,status
                     FROM users WHERE status!='archived'
                     ORDER BY discord_username COLLATE NOCASE`);
    res.json({ok:true,users:users.map(u=>({
      id:u.id,username:u.discord_username,avatarUrl:u.avatar_url,matricule:u.matricule,
      grade:u.grade,department:u.department,status:u.status
    }))});
  });

  app.get('/api/permission-center/users/:id',requirePermission('permissions.manage'),(req,res)=>{
    const id=Number(req.params.id);
    const {one,all}=getDatabaseHelpers();
    const user=one(`SELECT id,discord_username,avatar_url,matricule,grade,department,status FROM users WHERE id=?`,[id]);
    if(!user)return res.status(404).json({ok:false,message:'Employé introuvable.'});
    const overrides=all(`SELECT permission_key,effect FROM user_permission_overrides WHERE user_id=?`,[id]);
    res.json({
      ok:true,
      user:{id:user.id,username:user.discord_username,avatarUrl:user.avatar_url,matricule:user.matricule,grade:user.grade,department:user.department,status:user.status},
      inheritedPermissions:[...getDefaultPermissions(user.department)],
      effectivePermissions:getEffectivePermissions(user.id,user.department,one,all),
      overrides
    });
  });

  app.put('/api/permission-center/users/:id',requirePermission('permissions.manage'),(req,res)=>{
    const id=Number(req.params.id);
    const overrides=Array.isArray(req.body.overrides)?req.body.overrides:[];
    const allowed=new Set(PERMISSIONS.map(p=>p.key));
    const {one,run}=getDatabaseHelpers();
    if(!one('SELECT id FROM users WHERE id=?',[id]))return res.status(404).json({ok:false,message:'Employé introuvable.'});
    run('DELETE FROM user_permission_overrides WHERE user_id=?',[id]);
    let count=0;
    for(const item of overrides){
      if(!allowed.has(item.permissionKey)||!['allow','deny'].includes(item.effect))continue;
      run(`INSERT INTO user_permission_overrides(user_id,permission_key,effect) VALUES(?,?,?)`,[id,item.permissionKey,item.effect]);
      count++;
    }
    run(`INSERT INTO audit_logs(user_id,action,details,ip_address)
         VALUES(?,'PERMISSION_CENTER_UPDATE',?,?)`,
        [req.session.user.id,`Cible=${id}; Exceptions=${count}`,req.ip]);
    res.json({ok:true,message:'Permissions enregistrées.'});
  });
}
module.exports={registerPermissionCenterRoutes};
