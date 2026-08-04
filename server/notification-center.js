'use strict';
const {getDatabaseHelpers}=require('./database');
function sessionRequired(req,res,next){
  if(!req.session.user)return res.status(401).json({ok:false,message:'Session expirée.'});
  next();
}
function registerNotificationCenterRoutes(app){
  app.get('/api/notification-center',sessionRequired,(req,res)=>{
    const {all,one}=getDatabaseHelpers();
    const notifications=all(`SELECT id,type,title,message,link,read_at,created_at
                             FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 250`,
                             [req.session.user.id]);
    const unread=one(`SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read_at IS NULL`,
                     [req.session.user.id]);
    res.json({ok:true,unreadCount:Number(unread?.count||0),notifications:notifications.map(n=>({
      id:n.id,type:n.type,title:n.title,message:n.message,link:n.link,readAt:n.read_at,createdAt:n.created_at
    }))});
  });
  app.post('/api/notification-center/:id/read',sessionRequired,(req,res)=>{
    const {one,run}=getDatabaseHelpers();const id=Number(req.params.id);
    if(!one('SELECT id FROM notifications WHERE id=? AND user_id=?',[id,req.session.user.id]))
      return res.status(404).json({ok:false,message:'Notification introuvable.'});
    run(`UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`,[id,req.session.user.id]);
    res.json({ok:true});
  });
  app.post('/api/notification-center/read-all',sessionRequired,(req,res)=>{
    const {run}=getDatabaseHelpers();
    run(`UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL`,[req.session.user.id]);
    res.json({ok:true,message:'Toutes les notifications sont marquées comme lues.'});
  });
  app.delete('/api/notification-center/:id',sessionRequired,(req,res)=>{
    const {one,run}=getDatabaseHelpers();const id=Number(req.params.id);
    if(!one('SELECT id FROM notifications WHERE id=? AND user_id=?',[id,req.session.user.id]))
      return res.status(404).json({ok:false,message:'Notification introuvable.'});
    run('DELETE FROM notifications WHERE id=? AND user_id=?',[id,req.session.user.id]);
    res.json({ok:true,message:'Notification supprimée.'});
  });
}
module.exports={registerNotificationCenterRoutes};
