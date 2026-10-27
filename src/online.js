// Browser-side connection transport; never trusts client-side damage / hit claims.
export class OnlineConnection {
 constructor(onMessage,onStatus){
  this.onMessage=onMessage;this.onStatus=onStatus;
  this.socket=null;this.url='';this.roomId=null;this.playerId=null;this.token=null;
  this.intent=null;this.manual=false;this.disconnectedAt=0;this.reconnectTimer=null;
 }
 open(url,intent){
  if(!/^wss?:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(url))throw Error('伺服器必須是 ws:// 或 wss:// 網址');
  this.close();
  this.url=url;this.intent=intent;this.manual=false;
  return this._connect(false);
 }
 _connect(resume){
  this.onStatus(resume?'正在重新連線…':'連接伺服器中…');
  const ws=new WebSocket(this.url);this.socket=ws;
  ws.addEventListener('open',()=>{
   if(ws!==this.socket)return;
   const action=resume?{type:'RESUME',roomId:this.roomId,playerId:this.playerId,token:this.token,accessToken:this.intent?.accessToken}:this.intent;
   this.send(action);this.onStatus(resume?'已連上，恢復房間中…':'伺服器已連接，正在加入房間…');
  });
  ws.addEventListener('message',e=>{
   if(ws!==this.socket)return;
   let m;try{m=JSON.parse(e.data);}catch{return;}
   if(m.type==='JOINED'){this.roomId=m.roomId;this.playerId=m.playerId;this.token=m.token;this.disconnectedAt=0;}
   this.onMessage(m);
  });
  ws.addEventListener('error',()=>{if(ws===this.socket)this.onStatus('無法連接伺服器；確認主機網址與防火牆');});
  ws.addEventListener('close',()=>{
   if(this.manual||this.socket!==ws)return;
   this.onStatus('伺服器斷線，正在嘗試恢復…');
   if(!this.disconnectedAt)this.disconnectedAt=Date.now();
   if(this.roomId&&this.token&&Date.now()-this.disconnectedAt<29_000){
    this.reconnectTimer=setTimeout(()=>this._connect(true),1200);
   }else this.onStatus('連線中斷；請重新加入房間');
  });
 }
 send(obj){
  if(this.socket?.readyState!==WebSocket.OPEN)return false;
  this.socket.send(JSON.stringify(obj));return true;
 }
 close(){
  this.manual=true;clearTimeout(this.reconnectTimer);
  if(this.socket){this.socket.close();this.socket=null;}
 }
}
