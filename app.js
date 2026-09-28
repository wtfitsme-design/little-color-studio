(() => {
'use strict';
const $ = id => document.getElementById(id);
const W=768,H=496,N=W*H,S=0.8;
const paint=$('paint'),ctx=paint.getContext('2d',{alpha:true});
const wood=$('wood'),wc=wood.getContext('2d');
const pigments=[
  {id:'red',name:'红色',label:'红',rgb:[231,70,62],tone:261.63},
  {id:'yellow',name:'黄色',label:'黄',rgb:[249,203,53],tone:293.66},
  {id:'blue',name:'蓝色',label:'蓝',rgb:[56,126,198],tone:329.63},
  {id:'white',name:'白色',label:'白',rgb:[248,247,232],tone:392},
  {id:'black',name:'黑色',label:'黑',rgb:[54,59,57],tone:440}
];
const palettePath='M 832 99 C 715 23 488 18 327 43 C 151 59 51 139 40 263 C 28 402 117 506 258 550 C 379 589 541 591 693 552 C 793 527 876 466 907 380 C 931 313 895 297 857 298 C 825 298 811 286 820 261 C 833 225 895 211 897 170 C 899 142 865 112 832 99 Z';
const outline=new Path2D(palettePath);
const hole=new Path2D();hole.ellipse(754,430,53,37,-0.48,0,Math.PI*2);
const shape=new Path2D(outline);shape.addPath(hole);
const rgb=c=>`rgb(${c.map(Math.round).join(',')})`;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
let randomSeed=932541;
function rand(){randomSeed=(randomSeed*1664525+1013904223)>>>0;return randomSeed/4294967296;}
function paintWood(){
  wc.clearRect(0,0,960,620);wc.save();wc.clip(shape,'evenodd');
  let gradient=wc.createLinearGradient(100,20,740,640);gradient.addColorStop(0,'#e9d4a8');gradient.addColorStop(.28,'#f0dfb9');gradient.addColorStop(.67,'#e9d5aa');gradient.addColorStop(1,'#ddc497');wc.fillStyle=gradient;wc.fillRect(0,0,960,620);
  // Long, gently bending grain and tiny pores make the palette feel like wood.
  for(let i=0;i<1200;i++){
    let y=rand()*750-60,x=rand()*110-60,length=500+rand()*560;let alpha=.018+rand()*.052;
    wc.beginPath();wc.moveTo(x,y);wc.bezierCurveTo(x+length*.28,y-40-rand()*15,x+length*.65,y+24+rand()*35,x+length,y-70+rand()*25);
    wc.strokeStyle=`rgba(123,89,44,${alpha})`;wc.lineWidth=.35+rand()*1.5;wc.stroke();
  }
  for(let i=0;i<24000;i++){wc.fillStyle=rand()>.45?'rgba(122,89,39,.032)':'rgba(255,255,239,.1)';wc.fillRect(rand()*960,rand()*620,rand()*2.6+.4,rand()+.3);}
  wc.strokeStyle='#fffae087';wc.lineWidth=5;wc.stroke(outline);wc.strokeStyle='#baa07670';wc.lineWidth=4;wc.stroke(hole);
  wc.restore();wc.strokeStyle='#a5855237';wc.lineWidth=1.5;wc.stroke(shape);
}
paintWood();
const mask=new Uint8Array(N);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(wc.isPointInPath(shape,x/S,y/S,'evenodd'))mask[y*W+x]=1;}
let channels=Array.from({length:5},()=>new Float32Array(N));
let relief=new Float32Array(N),grain=new Float32Array(N);
for(let i=0;i<N;i++)grain[i]=rand();
let imageData=ctx.createImageData(W,H),dirty=true,currentTool='mix',brushSize=1;
let down=false,previous=null,moveQueue=[],lastInput=null,hoverPoint=null;
let totalAdded=2,hasMixed=false,result=null,mixDistance=0,latestBlend=null;
let pendingPaint=null,placementDrag=null;
const placement=$('placement'),placementBlob=$('placementBlob');
let audioEnabled=false,audioContext=null,scrapeNode=null,scrapeGain=null,noiseBuffer=null;
let toastTimer,hasInteracted=false,autoMixing=false,autoStart=0,currentChallenge=0,challengeWon=false,readTick=0;
let collection=[];
try{const saved=JSON.parse(localStorage.getItem('little-color-studio.v1')||'[]');if(Array.isArray(saved))collection=saved.filter(x=>x&&Array.isArray(x.rgb)&&x.rgb.length===3&&x.rgb.every(n=>Number.isFinite(n)&&n>=0&&n<=255)&&typeof x.name==='string').slice(0,24);}catch(e){}

// Artist's RYB pigment space: yellow and blue meet in green, red and blue in violet.
// The cube's interior is earthy, while white and black change the tint independently.
const corners=[
 [247,239,218],[231,70,62],[249,203,53],[241,132,43],
 [56,126,198],[143,86,179],[89,154,72],[126,100,65]
];
function pigmentColor(a,b,c,white=0,black=0,out=[0,0,0]){
  let chroma=a+b+c,sum=chroma+white+black;
  if(sum<.00001){out[0]=out[1]=out[2]=0;return out;}
  let mx=Math.max(a,b,c,.00001),r=a/mx,y=b/mx,bl=c/mx;
  let tw=white/(sum-black||1),tb=black/sum;
  tw=1-Math.pow(1-tw,1.25);tb=Math.pow(tb,.8);
  for(let j=0;j<3;j++){
    let c0=lerp(corners[0][j],corners[1][j],r),c1=lerp(corners[2][j],corners[3][j],r),c2=lerp(corners[4][j],corners[5][j],r),c3=lerp(corners[6][j],corners[7][j],r);
    let base=lerp(lerp(c0,c1,y),lerp(c2,c3,y),bl);
    out[j]=lerp(lerp(base,pigments[3].rgb[j],tw),pigments[4].rgb[j],tb);
  }return out;
}
function density(i){return channels[0][i]+channels[1][i]+channels[2][i]+channels[3][i]+channels[4][i];}
function makeDaub(canvas,color,seed=8){
  let c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);
  const temp=c.createImageData(w,h),p=temp.data;
  let cx=w*.5,cy=h*.51,rx=w*.32,ry=h*.31;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let nx=(x-cx)/rx,ny=(y-cy)/ry,ang=Math.atan2(ny,nx),rad=Math.hypot(nx,ny);
    let boundary=1+.05*Math.sin(ang*7+seed)+.05*Math.sin(ang*11+seed*2)+.035*Math.cos(ang*19+seed);
    if(rad>boundary)continue;
    let edge=clamp((boundary-rad)*18,0,1),ridge=Math.sin((x*.35+y*.73)+Math.sin(x*.08+seed)*5),fine=Math.sin(x*1.9+y*1.13);
    let shine=(ridge>0?ridge*10:ridge*7)+(1-rad)*8+fine*2+Math.sin(x*11+y*7+seed)*2;
    let rindex=(y*w+x)*4;
    p[rindex]=clamp(color[0]+shine,0,255);p[rindex+1]=clamp(color[1]+shine,0,255);p[rindex+2]=clamp(color[2]+shine,0,255);p[rindex+3]=Math.round(edge*255);
  }
  c.putImageData(temp,0,0);c.save();c.globalCompositeOperation='source-atop';
  c.strokeStyle='rgba(255,255,231,.2)';c.lineWidth=w/160;
  for(let n=0;n<12;n++){let x=cx-rx*.7+n*rx*.12;c.beginPath();c.moveTo(x,cy-ry*.75);c.bezierCurveTo(x+rx*.45,cy-ry*.25,x-rx*.4,cy+ry*.25,x+rx*.2,cy+ry*.7);c.stroke();}
  c.restore();
}
for(let i=0;i<pigments.length;i++){
  let p=pigments[i],button=document.createElement('button');button.className='paint-button';button.setAttribute('aria-label',`挤一点${p.name}颜料`);button.title=`添加${p.name}`;
  let c=document.createElement('canvas');c.width=140;c.height=100;c.setAttribute('aria-hidden','true');makeDaub(c,p.rgb,i+8);button.appendChild(c);
  let label=document.createElement('span');label.className='paint-label';label.textContent=p.label;button.appendChild(label);
  let plus=document.createElement('span');plus.className='add-mark';plus.textContent='+';button.appendChild(plus);button.addEventListener('click',()=>addPaint(i));$('paints').appendChild(button);
}
function deposit(px,py,id,radius=61,seed=0){
  const x0=Math.max(0,Math.floor(px-radius*1.2)),x1=Math.min(W-1,Math.ceil(px+radius*1.2));
  const y0=Math.max(0,Math.floor(py-radius)),y1=Math.min(H-1,Math.ceil(py+radius));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    let i=y*W+x;if(!mask[i])continue;
    let nx=(x-px)/radius,ny=(y-py)/(radius*.82),angle=Math.atan2(ny,nx),r=Math.hypot(nx,ny);
    const b=1+.045*Math.sin(7*angle+seed)+.04*Math.sin(11*angle+seed*.7)+.025*Math.sin(23*angle+seed);
    if(r>b)continue;
    let edge=clamp((b-r)*22,0,1),groove=Math.sin(x*.33+y*.51+Math.sin(y*.1+seed)*2+seed);
    let mass=(.62+Math.pow(1-clamp(r,0,1),.5)*.43+groove*.075)*edge;
    // Adding paint increases the amount; existing pigments remain on the palette.
    channels[id][i]+=mass;
    relief[i]=groove*.06+Math.sin(x*.8-y*.27)*.012;
  }
  dirty=true;
}
deposit(294,202,1,87,3);deposit(424,222,2,91,14);
const positions=[[350,290],[310,196],[416,222],[395,307],[257,292],[470,280],[330,340],[479,179],[235,223],[392,155]];
function addPaint(id){
  if(autoMixing)stopAuto();
  finishPlacement();
  // Reuse locations so children can keep adding paint without filling the page.
  let pos=totalAdded===0?[320,228]:totalAdded===1?[422,239]:positions[(totalAdded-2)%positions.length];
  pendingPaint={x:pos[0],y:pos[1],id,radius:58,seed:totalAdded*7+id};
  makeDaub($('placementCanvas'),pigments[id].rgb,id+8);
  placement.hidden=false;syncPlacement();
  placementBlob.setAttribute('aria-label',`拖动${pigments[id].name}到想放的位置；方向键移动，回车放下`);
  placementBlob.focus({preventScroll:true});
  totalAdded++;
  $('firstHint').classList.add('hidden');hasInteracted=true;
  chime(pigments[id].tone,.12);toast(`拖动这团${pigments[id].name}，松手放下`);
  if(totalAdded===1){hasMixed=false;result=null;latestBlend=null;resetResult();}
}
// Keep the new daub separate until it is dropped. Moving it never erases or
// picks up existing paint. Invalid drops keep the last valid palette position.
function canPlace(x,y,radius){
  x=Math.round(x);y=Math.round(y);
  const rx=Math.ceil(radius*1.13),ry=Math.ceil(radius*.93);
  if(x-rx<0||x+rx>=W||y-ry<0||y+ry>=H)return false;
  for(let dy=-ry;dy<=ry;dy++)for(let dx=-rx;dx<=rx;dx++){
    if(dx*dx/(rx*rx)+dy*dy/(ry*ry)<=1&&!mask[(y+dy)*W+x+dx])return false;
  }
  return true;
}
function syncPlacement(){
  if(!pendingPaint)return;
  const p=pendingPaint,ratio=paint.getBoundingClientRect().height/$('paletteWrap').getBoundingClientRect().height;
  placement.style.left=p.x/W*100+'%';placement.style.top=p.y/H*ratio*100+'%';
  placement.style.width=p.radius*2.26/W*100+'%';
  placement.style.height=p.radius*1.86/H*ratio*100+'%';
}
function movePlacement(x,y){
  if(!pendingPaint)return;
  if(canPlace(x,y,pendingPaint.radius)){
    pendingPaint.x=Math.round(x);pendingPaint.y=Math.round(y);syncPlacement();
  }
}
function finishPlacement(){
  if(!pendingPaint)return;
  const p=pendingPaint;pendingPaint=null;placementDrag=null;placement.hidden=true;placement.classList.remove('dragging');
  deposit(p.x,p.y,p.id,p.radius,p.seed);
  if(placementBlob.hasPointerCapture?.(placementPointer))placementBlob.releasePointerCapture(placementPointer);
  placementPointer=-1;
}
let placementPointer=-1;
placementBlob.addEventListener('pointerdown',e=>{
  if(!pendingPaint||placementDrag||(e.pointerType!=='touch'&&e.button!==0))return;
  e.preventDefault();const p=point(e);
  placementDrag={pointerId:e.pointerId,offsetX:p.x-pendingPaint.x,offsetY:p.y-pendingPaint.y};
  placementPointer=e.pointerId;placementBlob.setPointerCapture(e.pointerId);placement.classList.add('dragging');$('cursor').style.display='none';
});
placementBlob.addEventListener('pointermove',e=>{
  if(!placementDrag||e.pointerId!==placementDrag.pointerId)return;
  e.preventDefault();const p=point(e);movePlacement(p.x-placementDrag.offsetX,p.y-placementDrag.offsetY);
});
placementBlob.addEventListener('pointerup',e=>{
  if(!placementDrag||e.pointerId!==placementDrag.pointerId)return;
  e.preventDefault();const p=point(e);movePlacement(p.x-placementDrag.offsetX,p.y-placementDrag.offsetY);
  finishPlacement();paint.focus({preventScroll:true});toast('放好啦！来回搅几下，看看新颜色');
});
function cancelPlacementDrag(){placementDrag=null;placementPointer=-1;placement.classList.remove('dragging');}
placementBlob.addEventListener('pointercancel',cancelPlacementDrag);
placementBlob.addEventListener('lostpointercapture',cancelPlacementDrag);
placementBlob.addEventListener('keydown',e=>{
  if(!pendingPaint)return;
  const directions={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};
  if(directions[e.key]){e.preventDefault();const [dx,dy]=directions[e.key];movePlacement(pendingPaint.x+dx,pendingPaint.y+dy);}
  else if(e.key==='Enter'||e.key===' '){e.preventDefault();finishPlacement();paint.focus({preventScroll:true});}
});
$('placeHere').addEventListener('click',()=>{finishPlacement();paint.focus({preventScroll:true});toast('放好啦！可以开始搅拌了');});
window.addEventListener('resize',syncPlacement);
function render(){
  if(!dirty)return;dirty=false;
  let data=imageData.data,color=[0,0,0];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x,p=i*4,d=density(i);
    if(d<.025||!mask[i]){data[p+3]=0;continue;}
    pigmentColor(channels[0][i],channels[1][i],channels[2][i],channels[3][i],channels[4][i],color);
    let left=x>0?density(i-1):d,right=x<W-1?density(i+1):d,up=y>0?density(i-W):d,below=y<H-1?density(i+W):d;
    let dx=(right-left)+(relief[Math.min(N-1,i+1)]-relief[Math.max(0,i-1)])*1.4;
    let dy=(below-up)+(relief[Math.min(N-1,i+W)]-relief[Math.max(0,i-W)])*1.4;
    let light=clamp((-dx*.85-dy)*38,-39,34),micro=(grain[i]-.5)*5;
    let highlight=Math.max(0,light-4)*.19;
    for(let j=0;j<3;j++)data[p+j]=clamp(color[j]+light+micro+highlight,0,255);
    data[p+3]=Math.round(clamp(d*8,0,1)*255);
  }ctx.putImageData(imageData,0,0);
}

// Exchange equal amounts of pigment between neighboring points, and push only
// the excess paint forward. Every transfer is subtracted from its source and
// added to its destination. A thin opaque film stays behind on covered wood.
const patchMax=160*160;
const patch=Array.from({length:5},()=>new Float32Array(patchMax));
const changes=Array.from({length:5},()=>new Float32Array(patchMax));
const contactWeights=new Float32Array(patchMax);
const retainedFilm=.16;
function smear(px,py,dx,dy){
  const radii=[22,33,46],base=radii[brushSize],radius=currentTool==='knife'?base*1.2:currentTool==='brush'?base*.74:base;
  let speed=Math.hypot(dx,dy);if(speed<.1)return;
  let ux=dx/speed,uy=dy/speed;
  const distance=clamp(speed*.88,1,6),shiftX=Math.round(ux*distance),shiftY=Math.round(uy*distance),padding=Math.ceil(distance)+2;
  const l=Math.max(0,Math.floor(px-radius-padding)),r=Math.min(W-1,Math.ceil(px+radius+padding)),t=Math.max(0,Math.floor(py-radius-padding)),b=Math.min(H-1,Math.ceil(py+radius+padding));
  if(l>=r||t>=b)return;
  let pw=r-l+1,ph=b-t+1;
  for(let k=0;k<5;k++)changes[k].fill(0,0,pw*ph);
  contactWeights.fill(0,0,pw*ph);
  for(let y=t;y<=b;y++)for(let x=l;x<=r;x++){
    let i=y*W+x,j=(y-t)*pw+x-l;
    for(let k=0;k<5;k++)patch[k][j]=channels[k][i];
  }
  for(let y=t;y<=b;y++)for(let x=l;x<=r;x++){
    let i=y*W+x;if(!mask[i])continue;
    let ox=x-px,oy=y-py,along=ox*ux+oy*uy,cross=-ox*uy+oy*ux;
    let rad=currentTool==='knife'?Math.max(Math.abs(along)/(radius*.75),Math.abs(cross)/radius):Math.hypot(ox,oy)/radius;
    if(rad>1)continue;
    let edge=currentTool==='knife'?clamp((1-rad)*14,0,1):Math.pow(Math.max(0,1-rad*rad),.7);
    let tx=x+shiftX,ty=y+shiftY;
    if(tx<l||tx>r||ty<t||ty>b||!mask[ty*W+tx])continue;
    let j=(y-t)*pw+x-l,to=(ty-t)*pw+tx-l;
    let sourceMass=0,targetMass=0;
    for(let k=0;k<5;k++){sourceMass+=patch[k][j];targetMass+=patch[k][to];}
    if(sourceMass<.000001)continue;
    let ridge=Math.sin(cross*(currentTool==='brush'?1.9:.56)+Math.sin(along*.14)*.6);
    let bristle=currentTool==='brush'?.62+Math.sin(cross*2.3)*.31:1;
    let contact=edge*bristle*Math.min(1,speed/3);
    contactWeights[j]=contact;
    let exchange=contact*(currentTool==='mix'?.22:.16)*Math.min(sourceMass,targetMass);
    let pushed=contact*(currentTool==='knife'?.28:.22)*Math.max(0,sourceMass-retainedFilm);
    for(let k=0;k<5;k++){
      let forward=patch[k][j]/sourceMass*(pushed+exchange);
      let backward=targetMass>0?patch[k][to]/targetMass*exchange:0;
      let transfer=forward-backward;
      changes[k][j]-=transfer;changes[k][to]+=transfer;
    }
    relief[i]=lerp(relief[i],ridge*.047+Math.sin(cross*2.1)*.008,edge*.5);
  }
  // Gently blend all paint touched by this dab. Weighted relaxation conserves
  // each pigment and local thickness, but makes a short swipe visibly change color.
  const touched=[0,0,0,0,0];let touchedMass=0;
  for(let y=t;y<=b;y++)for(let x=l;x<=r;x++){
    let i=y*W+x,j=(y-t)*pw+x-l;
    for(let k=0;k<5;k++){
      const value=patch[k][j]+changes[k][j];channels[k][i]=value;
      touched[k]+=value*contactWeights[j];
    }
  }
  touchedMass=touched.reduce((a,b)=>a+b,0);
  if(touchedMass>0){
    const strength=currentTool==='mix'?.34:currentTool==='knife'?.26:.2;
    for(let k=0;k<5;k++)touched[k]/=touchedMass;
    for(let y=t;y<=b;y++)for(let x=l;x<=r;x++){
      const i=y*W+x,j=(y-t)*pw+x-l,amount=contactWeights[j]*strength;
      if(amount===0)continue;
      const mass=density(i);
      for(let k=0;k<5;k++)channels[k][i]=lerp(channels[k][i],mass*touched[k],amount);
    }
  }
  // Read an actual point under the tool, not an average of separate paint blobs.
  const sampleX=Math.round(px),sampleY=Math.round(py);
  if(sampleX>=0&&sampleX<W&&sampleY>=0&&sampleY<H){
    const i=sampleY*W+sampleX,mass=density(i);
    if(mask[i]&&mass>.025){
      latestBlend=channels.map(channel=>channel[i]/mass);
      if(latestBlend.filter(v=>v>.08).length>=2){hasMixed=true;mixDistance+=speed;}
    }
  }
  dirty=true;
}
function point(e){let box=paint.getBoundingClientRect();return{x:(e.clientX-box.left)/box.width*W,y:(e.clientY-box.top)/box.height*H};}
function cursorAt(e){let p=point(e),b=paint.getBoundingClientRect();hoverPoint=p;const cu=$('cursor');let rad=[22,33,46][brushSize]*(currentTool==='knife'?1.2:currentTool==='brush'?.74:1);cu.style.left=p.x/W*100+'%';cu.style.top=p.y/H*(b.height/$('paletteWrap').clientHeight)*100+'%';cu.style.width=cu.style.height=rad*2/W*b.width+'px';cu.style.borderRadius=currentTool==='knife'?'20%':'50%';cu.style.display=e.pointerType==='touch'?'none':'block';}
paint.addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.pointerType!=='touch')return;e.preventDefault();if(autoMixing)stopAuto();
  if(placementDrag)return;
  finishPlacement();
  down=true;previous=point(e);lastInput=previous;moveQueue.length=0;
  paint.setPointerCapture(e.pointerId);$('firstHint').classList.add('hidden');hasInteracted=true;cursorAt(e);startScrape();
});
paint.addEventListener('pointermove',e=>{
  cursorAt(e);if(!down)return;e.preventDefault();
  const coalesced=e.getCoalescedEvents?e.getCoalescedEvents():[e];
  for(const event of coalesced.length?coalesced:[e]){let p=point(event);moveQueue.push(p);lastInput=p;}
});
function endStroke(e){if(!down)return;down=false;stopScrape();if(e&&paint.hasPointerCapture(e.pointerId))paint.releasePointerCapture(e.pointerId);}
paint.addEventListener('pointerup',endStroke);paint.addEventListener('pointercancel',endStroke);paint.addEventListener('lostpointercapture',()=>{down=false;stopScrape();});
paint.addEventListener('pointerleave',()=>{if(!down)$('cursor').style.display='none';});
window.addEventListener('blur',()=>{down=false;moveQueue.length=0;previous=null;stopScrape();if(autoMixing)stopAuto();});
function processMove(p,budget=32){
  if(!previous){previous=p;return;}
  let dx=p.x-previous.x,dy=p.y-previous.y,len=Math.hypot(dx,dy),steps=Math.min(budget,Math.ceil(len/5));
  if(!steps)return;
  let used=Math.min(len,steps*5),stepX=dx/len*used/steps,stepY=dy/len*used/steps;
  for(let s=0;s<steps;s++){previous={x:previous.x+stepX,y:previous.y+stepY};smear(previous.x,previous.y,stepX,stepY);}
  return used<len-.1;
}
function tick(now){
  let changed=false;
  if(autoMixing){
    let elapsed=(now-autoStart)/1000;
    if(elapsed>7.5){stopAuto();toast(hasMixed?'颜料慢慢混在一起啦！':'再加一种颜色，继续试试看');}
    else{
      // Sweep the actual painted area, so the demonstration also works after reset.
      let a=elapsed*3.4,cx=autoCenter.x,cy=autoCenter.y;
      let p={x:cx+Math.cos(a)*autoCenter.rx*Math.sin(elapsed*.7+.7),y:cy+Math.sin(a)*autoCenter.ry};
      processMove(p,18);changed=true;
    }
  }else if(moveQueue.length){
    let p=moveQueue.shift();let more=processMove(p,18);if(more)moveQueue.unshift(p);changed=true;
    if(moveQueue.length>18)moveQueue.splice(1,moveQueue.length-4);
  }
  if(dirty)render();
  if(changed&&now-readTick>180){readTick=now;updateResult();}
  requestAnimationFrame(tick);
}
let autoCenter={x:360,y:245,rx:120,ry:82};
function startAuto(){
  finishPlacement();
  if(totalAdded===0){toast('先点左边的颜色，挤一点颜料吧');return;}
  if(autoMixing){stopAuto();return;}
  let mass=0,cx=0,cy=0,minX=W,maxX=0,minY=H,maxY=0;
  for(let y=0;y<H;y+=6)for(let x=0;x<W;x+=6){let d=density(y*W+x);if(d>.15){mass+=d;cx+=x*d;cy+=y*d;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
  if(mass<1)return;autoCenter={x:cx/mass,y:cy/mass,rx:clamp((maxX-minX)*.4,55,150),ry:clamp((maxY-minY)*.34,38,90)};
  autoMixing=true;autoStart=performance.now();previous={x:autoCenter.x,y:autoCenter.y};moveQueue.length=0;$('firstHint').classList.add('hidden');$('autoMix').innerHTML='停一下 <span>Ⅱ</span>';startScrape();
}
function stopAuto(){autoMixing=false;previous=null;$('autoMix').innerHTML='一起搅拌 <span>↻</span>';stopScrape();updateResult();}
$('autoMix').addEventListener('click',startAuto);
paint.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();startAuto();}});
for(const button of document.querySelectorAll('.tool'))button.addEventListener('click',()=>{
  finishPlacement();
  currentTool=button.dataset.tool;
  document.querySelectorAll('.tool').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
  $('toolHint').textContent={mix:'按住并慢慢拖动，让两种颜料碰个面',brush:'轻轻画一笔，把颜色带到新的地方',knife:'像抹果酱一样，把厚厚的颜料推开'}[currentTool];
});
$('brushSize').addEventListener('click',()=>{brushSize=(brushSize+1)%3;[...$('brushSize').children].forEach((el,i)=>el.classList.toggle('selected',i===brushSize));$('brushSize').setAttribute('aria-label',`当前${['小','中','大'][brushSize]}笔触，点击切换`);toast(`换成${['小','中','大'][brushSize]}笔触啦`);});
function resetResult(){
  $('resultCanvas').getContext('2d').clearRect(0,0,220,150);$('resultPlaceholder').hidden=false;$('resultName').textContent='搅一搅，看看吧';$('saveColor').disabled=true;
}
$('clear').addEventListener('click',()=>{
  pendingPaint=null;placement.hidden=true;cancelPlacementDrag();
  if(autoMixing)stopAuto();channels.forEach(a=>a.fill(0));relief.fill(0);totalAdded=0;hasMixed=false;latestBlend=null;result=null;mixDistance=0;moveQueue.length=0;previous=null;dirty=true;challengeWon=false;$('challengeSuccess').hidden=true;$('showHint').hidden=false;resetResult();$('firstHint').classList.add('hidden');toast('调色盘干净啦，选两种颜色再来一次');chime(523,.12);
});
function family(weights){let [r,y,b,w,k]=weights,mx=Math.max(r,y,b,.001);if(Math.min(r,y,b)/mx>.4)return 'brown';if(r<.19&&y>.15&&b>.15)return 'green';if(b<.19&&r>.15&&y>.15)return 'orange';if(y<.19&&r>.15&&b>.15)return 'purple';if(w>.25&&r>.25&&b<.15&&y<.15)return 'pink';return 'other';}
function updateResult(){
  if(!latestBlend||!hasMixed)return;
  let sources=latestBlend.filter(x=>x>.07).length;if(sources<2)return;
  const color=pigmentColor(...latestBlend).map(Math.round),name='新颜色';
  result={rgb:color,name,weights:[...latestBlend]};
  makeDaub($('resultCanvas'),color,12);$('resultPlaceholder').hidden=true;$('resultName').textContent='这是我调出的颜色';$('saveColor').disabled=false;
  if(!challengeWon&&family(latestBlend)===challenges[currentChallenge].family&&mixDistance>110){
    challengeWon=true;$('challengeSuccess').hidden=false;$('showHint').hidden=true;$('challengeHint').hidden=true;celebrate();toast('你调出了小任务的颜色！');speak('你找到小任务的颜色啦！');
  }
}
const leafArt=`<svg viewBox="0 0 100 80" aria-hidden="true"><path d="M47 68C21 70 13 45 24 28S67 9 83 5C83 39 75 65 47 68Z" fill="#7c9c58"/><path d="M29 48C38 32 65 26 81 9C70 43 50 57 29 48Z" fill="#92ad6f"/><path d="M26 78C32 59 56 40 76 17M40 57l-2-19M53 42l17-2" fill="none" stroke="#577b42" stroke-width="2.4" stroke-linecap="round"/><path d="m15 19 2-7m-7 11-6-1m82 37 5 4" stroke="#b7c696" stroke-width="2" stroke-linecap="round"/></svg>`;
const orangeArt=`<svg viewBox="0 0 100 80" aria-hidden="true"><path d="M52 18c-8-11-1-15 10-11-2 9-6 11-10 11" fill="#83a265"/><path d="M51 25v-12" stroke="#7a8456" stroke-width="3"/><path d="M77 46c0 21-13 30-28 29S20 63 21 46c0-17 10-26 29-25 17-2 27 10 27 25Z" fill="#eaa34f"/><path d="M32 37c3-5 7-6 10-5" stroke="#f7c57e" stroke-width="4" stroke-linecap="round"/><g fill="#d78c3c"><circle cx="63" cy="49" r="1"/><circle cx="65" cy="57" r="1"/><circle cx="55" cy="61" r="1"/></g></svg>`;
const grapeArt=`<svg viewBox="0 0 100 80" aria-hidden="true"><path d="M50 22q-6-17 11-18" fill="none" stroke="#7d9260" stroke-width="3"/><path d="M51 15q16-17 24-4-10 13-24 4" fill="#90a477"/><g stroke="#88719c" stroke-width="1"><circle cx="38" cy="29" r="12" fill="#aa8eb9"/><circle cx="59" cy="29" r="12" fill="#a085b3"/><circle cx="29" cy="46" r="12" fill="#a68bb6"/><circle cx="49" cy="47" r="12" fill="#9778ab"/><circle cx="69" cy="46" r="12" fill="#a087b4"/><circle cx="39" cy="63" r="11" fill="#a58ab5"/><circle cx="59" cy="63" r="11" fill="#9175a6"/><circle cx="50" cy="75" r="8" fill="#a88db9"/></g></svg>`;
const pinkArt=`<svg viewBox="0 0 100 80" aria-hidden="true"><g fill="#e5a4ad"><ellipse cx="50" cy="23" rx="12" ry="18"/><ellipse cx="31" cy="37" rx="12" ry="18" transform="rotate(-55 31 37)"/><ellipse cx="70" cy="37" rx="12" ry="18" transform="rotate(55 70 37)"/><ellipse cx="38" cy="59" rx="12" ry="18" transform="rotate(30 38 59)"/><ellipse cx="63" cy="59" rx="12" ry="18" transform="rotate(-30 63 59)"/></g><circle cx="50" cy="44" r="12" fill="#e6c76f"/><circle cx="47" cy="40" r="3" fill="#f1da8e"/></svg>`;
const challenges=[
 {family:'green',title:'调出小树叶的绿',text:'哪两种颜色，可以变成绿色呢？',hint:'试试黄色 ＋ 蓝色。画个圈，让它们抱在一起。',art:leafArt},
 {family:'orange',title:'调出小橘子的橙',text:'给小橘子，调一种暖暖的颜色。',hint:'试试红色 ＋ 黄色。黄色多一点，会更亮哦。',art:orangeArt},
 {family:'purple',title:'调出小葡萄的紫',text:'小葡萄的颜色，藏在哪里呢？',hint:'试试红色 ＋ 蓝色。慢慢搅拌，紫色就出现了。',art:grapeArt},
 {family:'pink',title:'调出小花朵的粉',text:'让红色变得柔柔的，要加什么呢？',hint:'试试红色 ＋ 白色。白色越多，粉色越浅。',art:pinkArt}
];
function displayChallenge(){let c=challenges[currentChallenge];$('targetArt').innerHTML=c.art;$('challengeTitle').textContent=c.title;$('challengeText').textContent=c.text;$('challengeHint').textContent=c.hint;$('challengeHint').hidden=true;$('challengeSuccess').hidden=true;$('showHint').hidden=false;$('showHint').innerHTML='给我一点提示 <span>＋</span>';challengeWon=false;}
$('nextChallenge').addEventListener('click',()=>{currentChallenge=(currentChallenge+1)%challenges.length;displayChallenge();chime(440,.1);});
$('showHint').addEventListener('click',()=>{$('challengeHint').hidden=!$('challengeHint').hidden;$('showHint').innerHTML=$('challengeHint').hidden?'给我一点提示 <span>＋</span>':'收起小提示 <span>－</span>';if(!$('challengeHint').hidden)speak(challenges[currentChallenge].hint);});
displayChallenge();
function renderCollection(){
  $('collectionCount').textContent=collection.length;const box=$('collectionColors');
  if(!collection.length)return;box.replaceChildren();
  for(const item of collection){let button=document.createElement('button');button.className='saved-color';button.style.setProperty('--saved',rgb(item.rgb));button.title=item.name;button.setAttribute('aria-label',`收藏的${item.name}`);const daub=document.createElement('i'),name=document.createElement('span');name.textContent=item.name;button.append(daub,name);button.addEventListener('click',()=>{toast(`你的${item.name}，已经好好收在口袋里啦`);speak(item.name);});box.appendChild(button);}
}
$('saveColor').addEventListener('click',()=>{
  if(!result)return;
  if(collection.some(c=>Math.hypot(...c.rgb.map((v,i)=>v-result.rgb[i]))<12)){toast('这颗颜色已经在口袋里啦，再试试别的配方');return;}
  if(collection.length>=24){toast('口袋装满啦，可以带走你的作品留作纪念');return;}
  collection.push({...result,name:`颜色 ${collection.length+1}`});let saved=true;try{localStorage.setItem('little-color-studio.v1',JSON.stringify(collection));}catch(e){saved=false;}
  renderCollection();$('collectionColors').scrollTo({left:$('collectionColors').scrollWidth,behavior:'smooth'});chime(659,.22);toast(saved?'新颜色装进口袋啦！':'颜色收好了；当前浏览器无法在下次打开时保留');
});
renderCollection();
$('export').addEventListener('click',()=>{
  finishPlacement();render();
  const output=document.createElement('canvas');output.width=1600;output.height=1160;let c=output.getContext('2d');c.fillStyle='#f5f3eb';c.fillRect(0,0,1600,1160);c.textAlign='center';c.fillStyle='#43553f';c.font='bold 44px "PingFang SC",sans-serif';c.fillText('小小调色家的颜色世界',800,105);c.fillStyle='#9b9f8a';c.font='20px "PingFang SC",sans-serif';c.fillText('每一种新颜色，都是一个小发现',800,150);c.drawImage(wood,128,190,1344,868);c.drawImage(paint,128,190,1344,868);c.fillStyle='#8f9980';c.font='20px "PingFang SC",sans-serif';c.fillText('小小的手，大大的色彩世界。',800,1095);
  output.toBlob(blob=>{if(!blob){toast('图片暂时没有生成，请再试一次');return;}let url=URL.createObjectURL(blob),a=document.createElement('a');a.download='小小调色家的作品.png';a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('你的作品已生成，留住这次颜色发现吧');},'image/png');
});
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600);}
function ensureAudio(){try{if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume();return audioContext;}catch(e){return null;}}
function chime(freq,duration=.18){if(!audioEnabled)return;const ac=ensureAudio();if(!ac)return;let o=ac.createOscillator(),g=ac.createGain();o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.0001,ac.currentTime);g.gain.exponentialRampToValueAtTime(.065,ac.currentTime+.014);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+duration);o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+duration+.03);}
function startScrape(){
  if(!audioEnabled||scrapeNode)return;const ac=ensureAudio();if(!ac)return;
  if(!noiseBuffer){noiseBuffer=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate);let d=noiseBuffer.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1);}
  scrapeNode=ac.createBufferSource();scrapeNode.buffer=noiseBuffer;scrapeNode.loop=true;let filter=ac.createBiquadFilter();filter.type='lowpass';filter.frequency.value=550;scrapeGain=ac.createGain();scrapeGain.gain.value=.028;scrapeNode.connect(filter);filter.connect(scrapeGain);scrapeGain.connect(ac.destination);scrapeNode.start();
}
function stopScrape(){if(scrapeNode){try{scrapeNode.stop();scrapeNode.disconnect();scrapeGain.disconnect();}catch(e){}scrapeNode=null;}}
function speak(text){if(!audioEnabled||!('speechSynthesis'in window))return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='zh-CN';utterance.rate=.85;utterance.volume=.65;window.speechSynthesis.speak(utterance);}
$('sound').addEventListener('click',()=>{audioEnabled=!audioEnabled;$('sound').setAttribute('aria-pressed',audioEnabled);$('sound').setAttribute('aria-label',audioEnabled?'关闭声音':'打开声音');$('sound').title=audioEnabled?'关闭声音':'打开声音';if(audioEnabled){ensureAudio();speak('你好，小小调色家。选两种颜色，慢慢搅一搅吧。');}else{stopScrape();if('speechSynthesis'in window)window.speechSynthesis.cancel();}toast(audioEnabled?'声音打开啦':'声音关掉啦');});
function celebrate(){
  chime(523,.2);setTimeout(()=>chime(659,.2),140);setTimeout(()=>chime(784,.35),280);
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  for(let i=0;i<26;i++){let el=document.createElement('i');el.style.left=20+rand()*60+'%';el.style.background=['#d7b762','#94aa7c','#db9b79','#84a7b6','#b29bbc'][i%5];el.style.animationDelay=rand()*.4+'s';el.style.setProperty('--drift',(rand()-.5)*260+'px');$('confetti').append(el);setTimeout(()=>el.remove(),3000);}
}
render();requestAnimationFrame(tick);
})();
