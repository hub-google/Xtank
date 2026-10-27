// Five freely authored camera layouts (not claims about the original game's naming).
export const CAMERA_VIEWS=Object.freeze([
 Object.freeze({name:'近距第三人稱',distance:5,height:2}),
 Object.freeze({name:'中距第三人稱',distance:8,height:3.5}),
 Object.freeze({name:'戰術俯角',distance:10,height:7}),
 Object.freeze({name:'低角高速',distance:6,height:1.5}),
 Object.freeze({name:'第一人稱',distance:-0.8,height:1.2})
]);
export function cameraPose(player,mode){
 if(!Number.isInteger(mode)||mode<0||mode>=CAMERA_VIEWS.length)throw Error('INVALID_CAMERA_MODE');
 const preset=CAMERA_VIEWS[mode];
 const angle=mode===4?(player.aimYaw||0):(player.yaw||0);
 const dx=Math.sin(angle),dz=Math.cos(angle);
 return {
  position:{x:player.x+dx*preset.distance,y:preset.height,z:player.z+dz*preset.distance},
  target:mode===4?{x:player.x-dx*15,y:1.2,z:player.z-dz*15}:{x:player.x,y:.85,z:player.z}
 };
}
