import L from 'leaflet'

const rainStops = [[0,[192,231,220]],[5,[114,196,184]],[10,[36,157,187]],[20,[34,144,180]],[40,[255,218,130]],[80,[251,124,64]],[130,[165,0,69]]]
const windStops = [[2,[76,127,182]],[5,[139,193,215]],[8,[210,230,208]],[11,[255,216,128]],[14,[255,135,69]],[17,[215,47,37]]]
export function windColor(v){return scaleColor(v,windStops)}
export function rainColor(v){return scaleColor(v,rainStops)}
function scaleColor(v,stops) {
  let i = stops.findIndex(x => x[0] >= v); if (i < 1) return stops[i < 0 ? stops.length - 1 : 0][1]
  const [a,ca] = stops[i-1], [b,cb] = stops[i], t = (v-a)/(b-a)
  return ca.map((c,j) => Math.round(c+(cb[j]-c)*t))
}

// Canvas is fixed to the map viewport; redraw on movement and dispose listeners.
export function fieldLayer(map, stations, wind = false, grid = []) {
  const canvas = L.DomUtil.create('canvas', 'weather-field', map.getContainer())
  Object.assign(canvas.style,{position:'absolute',inset:0,pointerEvents:'none',zIndex:450})
  const gridMap = new Map(grid.map(p => [`${p.latitude},${p.longitude}`,p]))
  const vector = (lat,lon) => {
    const x=Math.floor(lon*2)/2,y=Math.floor(lat*2)/2,fx=(lon-x)*2,fy=(lat-y)*2
    const cells=[[y,x,(1-fx)*(1-fy)],[y,x+.5,fx*(1-fy)],[y+.5,x,(1-fx)*fy],[y+.5,x+.5,fx*fy]]
    let u=0,v=0
    for(const [a,b,w] of cells){const p=gridMap.get(`${a},${b}`);if(!p)return null;u+=p.u*w;v+=p.v*w}
    return [u,-v]
  }
  const ctx = canvas.getContext('2d'); let frame, points=[], particles=[], moving=false
  const reset = () => {
    canvas.width=map.getSize().x; canvas.height=map.getSize().y
    points=stations.filter(s => s.latitude != null && s.longitude != null && (wind ? s.wind_speed != null && s.wind_direction != null : s.precipitation != null)).map(s => {
      const p=map.latLngToContainerPoint([s.latitude,s.longitude]); const a=s.wind_direction*Math.PI/180
      return {x:p.x,y:p.y,lat:s.latitude,lon:s.longitude,v:s.precipitation,u:-s.wind_speed*Math.sin(a),w:s.wind_speed*Math.cos(a)}
    })
    if(wind) { particles=Array.from({length:600},()=>({x:Math.random()*canvas.width,y:Math.random()*canvas.height,age:Math.random()*80})); return }
    ctx.clearRect(0,0,canvas.width,canvas.height)
    const step=6
    for(let y=0;y<canvas.height;y+=step) for(let x=0;x<canvas.width;x+=step) {
      const ll=map.containerPointToLatLng([x,y]);let total=0,sum=0,nearest=Infinity
      for(const p of points) { const km=Math.hypot((ll.lng-p.lon)*Math.cos(ll.lat*Math.PI/180),ll.lat-p.lat)*111; if(km>20) continue;nearest=Math.min(nearest,km); const w=1/(km*km+1);total+=w;sum+=w*p.v }
      if(!total || nearest>20 || sum/total<=0) continue
      ctx.fillStyle=`rgba(${rainColor(sum/total)},${.65*Math.min(1,(20-nearest)/5)})`;ctx.fillRect(x,y,step,step)
    }
  }
  // Bound interpolation to nearby stations: no invented open-ocean winds.
  let last=0
  const tick = time => {
    frame=requestAnimationFrame(tick);if(moving || time-last<35)return;last=time
    ctx.globalCompositeOperation='destination-in';ctx.fillStyle='rgba(0,0,0,.91)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='source-over'
    for(const p of particles){
      if(p.age++>80||p.x<0||p.y<0||p.x>canvas.width||p.y>canvas.height){p.x=Math.random()*canvas.width;p.y=Math.random()*canvas.height;p.age=0}
      const ll=map.containerPointToLatLng([p.x,p.y]);let sum=0,u=0,v=0
      if(grid.length){const velocity=vector(ll.lat,ll.lng);if(velocity){sum=1;[u,v]=velocity}}
      else for(const s of points){const km=Math.hypot((ll.lng-s.lon)*Math.cos(ll.lat*Math.PI/180),ll.lat-s.lat)*111;if(km>30)continue;const w=1/(km*km+1);sum+=w;u+=s.u*w;v+=s.w*w}
      if(!sum){p.age=81;continue}u/=sum;v/=sum
      ctx.strokeStyle=`rgb(${windColor(Math.hypot(u,v))})`;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.x,p.y);p.x+=u*.35;p.y+=v*.35;ctx.lineTo(p.x,p.y);ctx.stroke()
    }
  }
  const start=()=>{moving=true;ctx.clearRect(0,0,canvas.width,canvas.height)}, end=()=>{moving=false;reset()}
  map.on('movestart zoomstart',start);map.on('moveend resize',end);reset();if(wind)frame=requestAnimationFrame(tick)
  return ()=>{cancelAnimationFrame(frame);map.off('movestart zoomstart',start);map.off('moveend resize',end);canvas.remove()}
}

export function radarLayer(map, filename, onError) {
  const canvas=L.DomUtil.create('canvas','radar-field',map.getContainer()),source=document.createElement('canvas'),img=new Image()
  Object.assign(canvas.style,{position:'absolute',inset:0,pointerEvents:'none',zIndex:440})
  let alive=true,ready=false
  const draw=()=>{
    canvas.width=map.getSize().x;canvas.height=map.getSize().y;if(!ready)return
    const ctx=canvas.getContext('2d'),left=map.latLngToContainerPoint([0,115]).x,right=map.latLngToContainerPoint([0,126.5]).x
    // Official square raster is regular latitude/longitude, not Web Mercator.
    for(let y=0;y<canvas.height;y++){
      const lat=map.containerPointToLatLng([0,y]).lat,sy=(29.25-lat)/11.5*source.height
      if(sy>=0&&sy<source.height)ctx.drawImage(source,0,sy,source.width,1,left,y,right-left,1.5)
    }
  }
  img.onload=()=>{
    if(!alive)return;source.width=img.width;source.height=img.height
    const c=source.getContext('2d',{willReadFrequently:true});c.drawImage(img,0,0);const data=c.getImageData(0,0,img.width,img.height)
    for(let i=0;i<data.data.length;i+=4){const r=data.data[i],g=data.data[i+1],b=data.data[i+2],x=(i/4)%img.width,y=Math.floor(i/4/img.width)
      if(Math.max(r,g,b)-Math.min(r,g,b)<50 || (x>img.width*.022&&x<img.width*.044&&y>img.height*.077&&y<img.height*.205) || (x>img.width*.949&&y>img.height*.695) || (((x/img.width-.079)/.056)**2+((y/img.height-.932)/.033)**2<1))data.data[i+3]=0
    }
    c.putImageData(data,0,0);ready=true;draw()
  }
  img.onerror=()=>alive&&onError('此時間雷達影像載入失敗，請切換時間或更新資料。')
  img.src=`/api/radar/image/${filename}`;map.on('move zoom resize',draw)
  return ()=>{alive=false;img.onload=null;img.onerror=null;map.off('move zoom resize',draw);canvas.remove()}
}

// Smooth envelope interpolates published 70% radii, not a new probabilistic forecast.
export function probabilityEnvelope(points) {
  const fixes=points.filter(p=>p.probability_radius>0).sort((a,b)=>a.valid_at.localeCompare(b.valid_at))
  if(fixes.length<2)return []
  const left=[],right=[]
  fixes.forEach((p,i)=>{
    const a=fixes[Math.max(0,i-1)],b=fixes[Math.min(fixes.length-1,i+1)]
    const cos=Math.cos(p.latitude*Math.PI/180),angle=Math.atan2(b.latitude-a.latitude,(b.longitude-a.longitude)*cos)
    const dy=Math.cos(angle)*p.probability_radius/111,dx=-Math.sin(angle)*p.probability_radius/(111*cos)
    left.push([p.latitude+dy,p.longitude+dx]);right.push([p.latitude-dy,p.longitude-dx])
  })
  const last=fixes.at(-1),before=fixes.at(-2),angle=Math.atan2(last.latitude-before.latitude,(last.longitude-before.longitude)*Math.cos(last.latitude*Math.PI/180))
  const cap=Array.from({length:13},(_,i)=>{const theta=angle+Math.PI/2-i*Math.PI/12;return [last.latitude+Math.sin(theta)*last.probability_radius/111,last.longitude+Math.cos(theta)*last.probability_radius/(111*Math.cos(last.latitude*Math.PI/180))]})
  return [...left,...cap,...right.reverse()]
}
