'use strict';
const {getDatabaseHelpers}=require('./database');
const {requirePermission}=require('./permissions');

function registerAuditRoutes(app){
  app.get('/api/audit',requirePermission('maintenance.manage'),(req,res)=>{
    const q=String(req.query.q||'').trim();
    const action=String(req.query.action||'').trim();
    const {all}=getDatabaseHelpers();
    const clauses=[],params=[];
    if(q){
      clauses.push(`(COALESCE(u.discord_username,'') LIKE ? OR COALESCE(a.details,'') LIKE ? OR COALESCE(a.ip_address,'') LIKE ?)`);
      const like=`%${q}%`;params.push(like,like,like);
    }
    if(action){clauses.push('a.action=?');params.push(action);}
    const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
    const entries=all(`SELECT a.id,a.action,a.details,a.ip_address,a.created_at,
                              u.discord_username AS actor_name,u.matricule AS actor_matricule
                       FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
                       ${where} ORDER BY a.created_at DESC LIMIT 500`,params);
    const actions=all(`SELECT DISTINCT action FROM audit_logs ORDER BY action`).map(x=>x.action);
    res.json({ok:true,actions,entries:entries.map(e=>({
      id:e.id,action:e.action,details:e.details,ipAddress:e.ip_address,createdAt:e.created_at,
      actorName:e.actor_name||'Système',actorMatricule:e.actor_matricule||'—'
    }))});
  });
}
module.exports={registerAuditRoutes};
