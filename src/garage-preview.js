import * as THREE from 'three';
import {TANKS} from './simulation.js';

// One low-cost 3D renderer per open garage, disposed when the panel changes.
export function mountGaragePreview(root,initialTank='X',onChoose=()=>{}){
 if(!root)return ()=>{};
 const scene=new THREE.Scene();
 scene.background=new THREE.Color(0x142d46);
 const camera=new THREE.PerspectiveCamera(40,1.8,.1,100);
 camera.position.set(5,3.5,7.5);camera.lookAt(0,.55,0);
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
 root.appendChild(renderer.domElement);
 const light=new THREE.HemisphereLight(0xe4edff,0x49617b,2);scene.add(light);
 const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(3,6,4);scene.add(sun);
 const floor=new THREE.Mesh(new THREE.CylinderGeometry(2.5,2.5,.10,48),
   new THREE.MeshStandardMaterial({color:0x334d62,roughness:.85}));
 floor.position.y=-.06;scene.add(floor);
 const model=new THREE.Group();scene.add(model);
 function createPart(geometry,material,x,y,z){
  const mesh=new THREE.Mesh(geometry,material);
  mesh.position.set(x,y,z);model.add(mesh);return mesh;
 }
 function clear(){
  for(const child of [...model.children]){
   model.remove(child);
   child.geometry?.dispose();
   if(Array.isArray(child.material))child.material.forEach(m=>m.dispose());else child.material?.dispose();
  }
 }
 function choose(tank){
  const kind=Object.hasOwn(TANKS,tank)?tank:'X', spec=TANKS[kind];
  clear();model.rotation.y=0;
  const metal=new THREE.MeshStandardMaterial({color:spec.color,roughness:.48,metalness:.36});
  const dark=new THREE.MeshStandardMaterial({color:0x232c39,roughness:.9});
  const bright=new THREE.MeshStandardMaterial({color:0xbecedb,roughness:.3,metalness:.6});
  const width=.98*spec.collision,bodyLength=2*(spec.speed>8?.9:1.08);
  createPart(new THREE.BoxGeometry(width,.45,bodyLength),metal,0,.48,0);
  createPart(new THREE.BoxGeometry(width*.75,.37,.72),metal,0,.89,-.16);
  createPart(new THREE.CylinderGeometry(.16,.16,1.55,12),bright,0,.91,-.95).rotation.x=Math.PI/2;
  for(const side of [-1,1]){
   createPart(new THREE.BoxGeometry(.29,.43,bodyLength+.20),dark,side*(width/2+.12),.30,0);
   for(const z of [-.74,-.25,.25,.74]){
    createPart(new THREE.CylinderGeometry(.18,.18,.12,12),bright,side*(width/2+.19),.27,z).rotation.z=Math.PI/2;
   }
  }
  // Shared materials remain attached to the meshes until the preview is replaced.
 }
 // The generated meshes share materials; dispose them only when the entire model is cleared.
 const select=document.createElement('select');
 select.setAttribute('aria-label','選擇預覽坦克');
 for(const name of Object.keys(TANKS)){
  const option=document.createElement('option');option.value=name;option.textContent=name+'-TANK';select.appendChild(option);
 }
 root.prepend(select);select.value=Object.hasOwn(TANKS,initialTank)?initialTank:'X';
 select.addEventListener('change',()=>{choose(select.value);onChoose(select.value)});
 let pointerX=null,frameId=0,disposed=false;
 const onDown=e=>{pointerX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)};
 const onMove=e=>{if(pointerX===null)return;model.rotation.y+=(e.clientX-pointerX)*.012;pointerX=e.clientX};
 const onUp=()=>{pointerX=null};
 renderer.domElement.addEventListener('pointerdown',onDown);
 renderer.domElement.addEventListener('pointermove',onMove);
 renderer.domElement.addEventListener('pointerup',onUp);
 renderer.domElement.addEventListener('pointercancel',onUp);
 function draw(){
  if(disposed)return;
  const width=Math.max(180,Math.round(root.clientWidth||480));
  const height=220;
  if(renderer.domElement.width!==Math.round(width*renderer.getPixelRatio())||renderer.domElement.height!==Math.round(height*renderer.getPixelRatio())){
   renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
  }
  if(root.isConnected&&root.offsetParent!==null){
   if(pointerX===null)model.rotation.y+=.006;
   renderer.render(scene,camera);
  }
  frameId=requestAnimationFrame(draw);
 }
 choose(select.value);draw();
 return ()=>{
  disposed=true;cancelAnimationFrame(frameId);clear();
  floor.geometry.dispose();floor.material.dispose();
  renderer.domElement.removeEventListener('pointerdown',onDown);
  renderer.domElement.removeEventListener('pointermove',onMove);
  renderer.domElement.removeEventListener('pointerup',onUp);
  renderer.domElement.removeEventListener('pointercancel',onUp);
  renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();select.remove();
 };
}
