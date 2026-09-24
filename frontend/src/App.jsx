import React, { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { fieldLayer, radarLayer, windColor, probabilityEnvelope } from './mapFields'

const layers = [
  ['temperature', '氣溫', '°C'], ['precipitation', '雨量', 'mm'],
  ['humidity', '濕度', '%'], ['wind_speed', '風速與風向', 'm/s'],
  ['weather', '天氣現象', ''], ['radar', '雷達回波', ''],
  ['typhoon', '颱風路徑', ''], ['earthquake', '最近地震', '']
]
const forecastClock = value => {
  const d = new Date(value)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'numeric', hourCycle:'h23' }).formatToParts(d).map(x => [x.type,x.value]))
  const h = Number(parts.hour)
  return `${parts.year}/${parts.month}/${parts.day} ${h < 12 ? '早上' : '下午'}${h % 12 || 12}點`
}
const weatherSymbol = text => !text ? '—' : /雷/.test(text) ? '⛈️' : /雪/.test(text) ? '🌨️' : /雨/.test(text) ? '🌧️' : /霧/.test(text) ? '🌫️' : /陰/.test(text) ? '☁️' : /雲/.test(text) ? '⛅' : '☀️'
const fmt = (value, unit = '') => value === null || value === undefined || value === '' ? '缺值' : `${value}${unit}`
const clock = value => value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '尚無資料'
const ageMinutes = value => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)) : null
const freshness = (value, limit = 40) => {
  const age = ageMinutes(value)
  return age === null ? '未同步' : age <= limit ? '資料新鮮' : `已過 ${age} 分鐘`
}
async function get(path) {
  const response = await fetch(`/api/${path}`)
  if (!response.ok) throw new Error(`${path}：HTTP ${response.status}`)
  return response.json()
}

function WeatherMap({ stations, earthquakes, typhoonPoints, mode, base, boundaries, labels, focus, windGrid, radarFrame, typhoonTime, onSelect, onError }) {
  const element = useRef(null), map = useRef(null), tile = useRef(null), drawn = useRef(null), border = useRef(null)
  const [zoom, setZoom] = useState(7)
  useEffect(() => { if (focus && map.current) map.current.flyTo([focus.latitude, focus.longitude], 11, { duration: 1 }) }, [focus])
  useEffect(() => {
    const instance = L.map(element.current, { zoomControl: false }).setView([23.75, 121], 7)
    map.current = instance
    instance.on('zoomend', () => setZoom(instance.getZoom()))
    L.control.zoom({ position: 'bottomright' }).addTo(instance)
    drawn.current = L.layerGroup().addTo(instance)
    return () => instance.remove()
  }, [])
  useEffect(() => {
    if (!map.current) return
    if (tile.current) map.current.removeLayer(tile.current)
    const url = base === 'dark'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    tile.current = L.tileLayer(url, { maxZoom: 18, attribution: base === 'dark'
      ? 'Tiles &copy; Esri' : '&copy; OpenStreetMap contributors' }).addTo(map.current)
    tile.current.bringToBack()
  }, [base])
  useEffect(() => {
    if (!drawn.current) return
    drawn.current.clearLayers()
    if (mode === 'typhoon') {
      typhoonPoints.filter(x => x.valid_at === typhoonTime).forEach(x => {
        if(x.radius15) L.circle([x.latitude,x.longitude], {radius:x.radius15*1000,color:'#f5c56c',fillOpacity:.12,weight:2}).addTo(drawn.current)
        if(x.radius25) L.circle([x.latitude,x.longitude], {radius:x.radius25*1000,color:'#e77477',fillOpacity:.2,weight:2}).addTo(drawn.current)
        L.circleMarker([x.latitude,x.longitude],{radius:11,color:'#fff',weight:3,fillColor:'#e87474',fillOpacity:1}).addTo(drawn.current)
      })
      const names = [...new Set(typhoonPoints.map(x => x.name))]
      for (const name of names) {
        const envelope=probabilityEnvelope(typhoonPoints.filter(x => x.name===name && x.kind==='forecast'))
        if(envelope.length)L.polygon(envelope,{color:'#cfac5b',weight:1,dashArray:'5 5',fillColor:'#d4b660',fillOpacity:.12}).addTo(drawn.current)
        for (const kind of ['analysis', 'forecast']) {
          const fixes = typhoonPoints.filter(x => x.name === name && x.kind === kind).sort((a,b) => a.valid_at.localeCompare(b.valid_at))
          const lastAnalysis=typhoonPoints.filter(x => x.name===name && x.kind==='analysis').sort((a,b)=>a.valid_at.localeCompare(b.valid_at)).at(-1)
          const track=kind==='forecast' && lastAnalysis ? [lastAnalysis,...fixes] : fixes
          if (track.length > 1) L.polyline(track.map(x => [x.latitude, x.longitude]), {
            color: kind === 'analysis' ? '#fdaf70' : '#9fcbff', weight: 3, dashArray: kind === 'forecast' ? '5 8' : null
          }).addTo(drawn.current)
          fixes.forEach((fix, index) => L.circleMarker([fix.latitude, fix.longitude], { radius: 5,
            color: kind === 'analysis' ? '#fdaf70' : '#9fcbff', fillOpacity: 1 })
            .bindTooltip(`${new Date(fix.valid_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'numeric',hour12:false})}`, {permanent:kind === 'forecast' && (zoom >= 5 || index % 3 === 0 || fix.valid_at === typhoonTime),direction:'right',className:'typhoon-label'}).bindPopup(`${name}｜${kind === 'analysis' ? '實際' : '預報'}<br>${clock(fix.valid_at)}<br>${fmt(fix.wind_speed,' m/s')} · ${fmt(fix.pressure,' hPa')}`).addTo(drawn.current))
        }
      }
    }
    if (mode === 'earthquake') earthquakes.forEach(x => L.circleMarker([x.latitude, x.longitude], {
      radius: Math.max(7, (x.magnitude || 3) * 3), color: '#ffb089', fillColor: '#f17b55', fillOpacity: .45
    }).bindPopup(`<strong>規模 ${fmt(x.magnitude)}</strong><br>${x.location || ''}<br>${clock(x.origin_at)}<br>深度 ${fmt(x.depth_km, ' km')}`)
      .addTo(drawn.current))
    let visibleStations = stations
    if (zoom < 9 && !['humidity','precipitation','wind_speed'].includes(mode)) {
      const groups = new Map()
      stations.filter(x => x.latitude != null && x.longitude != null).forEach(x => {
        groups.set(x.county, [...(groups.get(x.county) || []), x])
      })
      visibleStations = [...groups.values()].map(group => {
        const centerLat = group.reduce((sum, x) => sum + x.latitude, 0) / group.length
        const centerLon = group.reduce((sum, x) => sum + x.longitude, 0) / group.length
        return group.reduce((best, x) => {
          const score = (x.latitude - centerLat) ** 2 + (x.longitude - centerLon) ** 2 + (x.temperature == null ? 100 : 0)
          return !best || score < best.score ? { station: x, score } : best
        }, null).station
      })
    }
    if (!['earthquake', 'typhoon', 'radar', 'precipitation'].includes(mode)) visibleStations.forEach(station => {
      if (station.latitude == null || station.longitude == null) return
      if (mode === 'humidity') {
        const h = station.humidity
        L.circleMarker([station.latitude, station.longitude], { radius: 6,
          color: '#344f56', weight: 1, fillOpacity: .85,
          fillColor: h == null ? '#83909b' : h < 60 ? '#dfc27d' : h < 75 ? '#c8ebe4' : h < 90 ? '#5aafa6' : '#096c69'
        }).on('click', () => onSelect(station)).addTo(drawn.current)
        return
      }
      if (mode === 'wind_speed') {
        if (!labels || station.wind_direction == null || station.wind_speed == null) return
        L.marker([station.latitude, station.longitude], { icon: L.divIcon({className:'wind-marker', html: `<span style="color:rgb(${windColor(station.wind_speed)});transform:rotate(${station.wind_direction + 90}deg)">➤</span>`, iconSize:[24,24]}) }).on('click', () => onSelect(station)).addTo(drawn.current)
        return
      }
      const value = station[mode === 'radar' ? 'temperature' : mode]
      const shown = mode === 'weather' ? (value || '—') : mode === 'wind_speed'
        ? `${fmt(value)} ${station.wind_direction == null ? '' : Math.round(station.wind_direction) + '°'}`
        : fmt(value)
      const heat = mode === 'temperature' || mode === 'radar' ? Number(station.temperature) : null
      const tone = heat == null || Number.isNaN(heat) ? 'neutral' : heat >= 30 ? 'warm' : heat >= 24 ? 'mild' : 'cool'
      const marker = L.marker([station.latitude, station.longitude], {
        icon: L.divIcon({ className: 'station-icon', html: `<span class="map-pill ${tone}">${labels ? shown : '•'}</span>`, iconSize: [52, 28], iconAnchor: [26, 14] })
      }).addTo(drawn.current)
      marker.on('click', () => onSelect(station))
    })
  }, [stations, earthquakes, typhoonPoints, mode, labels, onSelect, zoom, typhoonTime])
  useEffect(() => {
    if (!map.current) return
    if (mode === 'precipitation' || mode === 'wind_speed') return fieldLayer(map.current, stations, mode === 'wind_speed', windGrid)
    if (mode === 'radar' && radarFrame) return radarLayer(map.current, radarFrame.filename, onError)
  }, [mode, stations, windGrid, radarFrame?.filename, onError])
  useEffect(() => {
    if(mode === 'typhoon' && typhoonPoints.length) map.current.fitBounds([[21.8,119.5],[25.3,122],...typhoonPoints.map(x => [x.latitude,x.longitude])],{padding:[75,75],maxZoom:6})
  }, [mode, typhoonPoints])
  useEffect(() => {
    if (!map.current) return
    if (border.current) { map.current.removeLayer(border.current); border.current = null }
    if (!boundaries) return
    fetch('/county-boundaries.geojson').then(x => x.ok ? x.json() : Promise.reject()).then(geo => {
      if (map.current && boundaries) border.current = L.geoJSON(geo, {
        style: { color: '#8dbdbc', weight: 1, opacity: .55, fillOpacity: 0 }
      }).addTo(map.current)
    }).catch(() => {})
  }, [boundaries])
  return <div className="map" ref={element} aria-label="臺灣氣象觀測地圖" />
}

export default function App() {
  const [stations, setStations] = useState([]), [locations, setLocations] = useState([])
  const [warnings, setWarnings] = useState([]), [warningStatus, setWarningStatus] = useState(null)
  const [earthquakes, setEarthquakes] = useState([]), [typhoonPoints, setTyphoonPoints] = useState([])
  const [forecast, setForecast] = useState({ forecasts: [], issued_at: null })
  const [analysis, setAnalysis] = useState(null), [selected, setSelected] = useState(null)
  const [county, setCounty] = useState(''), [town, setTown] = useState('')
  const [mode, setMode] = useState('temperature'), [base, setBase] = useState('dark')
  const [boundaries, setBoundaries] = useState(true), [labels, setLabels] = useState(true)
  const [tab, setTab] = useState('map'), [panels, setPanels] = useState(() => window.innerWidth >= 700), [busy, setBusy] = useState(false)
  const [windGrid,setWindGrid] = useState([])
  const [radarFrames, setRadarFrames] = useState([]), [frameIndex,setFrameIndex] = useState(0), [playing,setPlaying] = useState(false)
  const [stormIndex,setStormIndex] = useState(0)
  const stormTimes = [...new Set(typhoonPoints.map(x => x.valid_at))].sort()
  const storm = typhoonPoints.find(x => x.valid_at === stormTimes[stormIndex])
  useEffect(() => { setPlaying(false) }, [mode])
  useEffect(() => { if(!playing)return; const timer=setInterval(() => { if(mode === 'radar')setFrameIndex(i => (i+1)%Math.max(1,radarFrames.length)); else setStormIndex(i => (i+1)%Math.max(1,stormTimes.length)) },900);return () => clearInterval(timer) },[playing,mode,radarFrames.length,stormTimes.length])
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const selectedLocation = locations.find(x => x.county === county && x.town === town)
  const counties = useMemo(() => [...new Set(locations.map(x => x.county))].sort(), [locations])
  const towns = useMemo(() => locations.filter(x => x.county === county).map(x => x.town).sort(), [locations, county])
  const latestTime = stations.map(x => x.observed_at).sort().at(-1)
  const available = stations.filter(x => x.temperature != null)
  const maxStation = available.reduce((a, b) => !a || b.temperature > a.temperature ? b : a, null)
  const minStation = available.reduce((a, b) => !a || b.temperature < a.temperature ? b : a, null)
  async function load() {
    try {
      const [s, l, w, e, t, r, g] = await Promise.all([
        get('stations'), get('locations'), get('warnings'), get('earthquakes'), get('typhoons'), get('radar'), get('wind')
      ])
      setStations(s.stations); setLocations(l.locations); setWarnings(w.warnings)
      setWindGrid(g.points); setRadarFrames(r.frames); setFrameIndex(Math.max(0,r.frames.length-1)); setStormIndex(Math.max(0,t.points.filter(x => x.kind === 'analysis').length-1));
      setWarningStatus(w.status); setEarthquakes(e.earthquakes); setTyphoonPoints(t.points)
      setError('')
    } catch (err) { setError(`讀取失敗：${err.message}`) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    let cancelled = false
    if (!selectedLocation) { setForecast({ forecasts: [], issued_at: null }); setAnalysis(null); return }
    setForecast({forecasts:[],issued_at:null}); setAnalysis(null)
    Promise.all([get(`forecast?location_id=${selectedLocation.id}`), get(`analysis?location_id=${selectedLocation.id}`)])
      .then(([f, a]) => { if(!cancelled){setForecast(f); setAnalysis(a)} }).catch(err => {if(!cancelled)setError(err.message)})
    return () => {cancelled=true}
  }, [selectedLocation?.id])
  async function refresh() {
    setBusy(true); setNotice('正在同步資料…')
    const datasets = ['O-A0003-001', 'O-A0001-001', 'E-A0015-001', 'W-C0034-005', 'warnings', 'radar', 'wind']
    if (county) {
      const index = ['宜蘭縣','桃園市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','臺東縣','花蓮縣','澎湖縣','基隆市','新竹市','嘉義市','臺北市','高雄市','新北市','臺中市','臺南市','連江縣','金門縣'].indexOf(county)
      if (index >= 0) datasets.push(`F-D0047-${String(index * 4 + 1).padStart(3, '0')}`)
    }
    const outcomes = []
    for (const dataset of datasets) {
      try {
        const response = await fetch(`/api/refresh?dataset=${dataset}`, { method: 'POST' })
        const value = await response.json()
        outcomes.push(`${dataset}: ${response.ok ? (value.cached ? value.message : value.received + ' 筆') : (value.error || `HTTP ${response.status}`)}`)
        setNotice(outcomes.join(' · '))
        if (response.status === 403) break
      } catch { outcomes.push(`${dataset}: 連線失敗`) }
    }
    setNotice(outcomes.join(' · ')); setBusy(false); await load()
    if (selectedLocation) {
      const [f, a] = await Promise.all([get(`forecast?location_id=${selectedLocation.id}`), get(`analysis?location_id=${selectedLocation.id}`)])
      setForecast(f); setAnalysis(a)
    }
  }
  function locate() {
    if (!navigator.geolocation) { setNotice('此瀏覽器不支援定位'); return }
    navigator.geolocation.getCurrentPosition(position => {
      const st = stations.filter(x => x.latitude != null && x.longitude != null).reduce((best, x) => {
        const distance = (x.latitude - position.coords.latitude) ** 2 + (x.longitude - position.coords.longitude) ** 2
        return !best || distance < best.distance ? { station: x, distance } : best
      }, null)
      if (st) setSelected(st.station)
    }, () => setNotice('未取得定位權限，仍可手動選擇測站。'))
  }
  return <div className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><img src="/taiwan.svg" alt="臺灣島" width="28" height="36"/></span><div><strong>島嶼天氣誌</strong><small>TAIWAN WEATHER ATLAS</small></div></div>
      <nav><button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>觀測地圖</button><button className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}>預報驗證</button></nav>
      <span className="live"><i />{freshness(latestTime)}</span></header>
    <main>
    <section className="workspace">{tab === 'map' ? <><div className="map-head"><div><span className="eyebrow">EXPLORE THE ISLAND</span><h2>{layers.find(x => x[0] === mode)?.[1]}觀測圖</h2><p>點選測站，檢視完整觀測與資料時間。</p></div><div className="map-actions"><button onClick={locate}>◎ 附近測站</button><button onClick={() => setBase(base === 'dark' ? 'street' : 'dark')}>{base === 'dark' ? '街道底圖' : '深色底圖'}</button></div></div>
      <div className="map-frame">{panels && <aside className="overview-card"><div className="eyebrow">LIVE CONDITIONS / 01</div><h1>此刻，<br/><em>島上的天氣</em></h1>
      <p className="intro">從測站看見正在發生的事，也檢查預報與實際相差多少。</p>
      <div className="section-label">資料概況 <span>氣象署觀測</span></div>
      <div className="stat-grid"><div><small>目前測站</small><strong>{stations.length}</strong><span>站</span></div><div><small>有效氣溫</small><strong>{available.length}</strong><span>站</span></div><div><small>最高氣溫</small><strong>{fmt(maxStation?.temperature)}</strong><span>°C · {maxStation?.county || '—'}</span></div><div><small>最低氣溫</small><strong>{fmt(minStation?.temperature)}</strong><span>°C · {minStation?.county || '—'}</span></div></div>
      <div className="time-note">觀測時間：{clock(latestTime)}<br/>更新頻率依氣象署資料發布為準</div>
      <div className="section-label">天氣特報 <span>網站擷取</span></div>
      <div className="warning-box">{warningStatus?.status !== 'ok' ? '特報網站尚未同步；不能判定目前無特報。' : warnings.length ? warnings.map(w => <a key={w.code} href={w.source_url} target="_blank" rel="noreferrer">● {w.title} ↗</a>) : '目前未偵測到有效特報。'}<small>來源：中央氣象署公開網站 · {clock(warningStatus?.checked_at)}</small></div>

      {notice && <div className="notice">{notice}</div>}{error && <div className="error">{error}</div>}
    </aside>}<WeatherMap stations={stations} earthquakes={earthquakes} typhoonPoints={typhoonPoints} mode={mode} base={base} boundaries={boundaries} labels={labels} focus={selected} windGrid={windGrid} radarFrame={radarFrames[frameIndex]} typhoonTime={stormTimes[stormIndex]} onError={setError} onSelect={setSelected}/>
        <button className="panel-toggle" aria-expanded={panels} onClick={() => setPanels(!panels)}>{panels ? '隱藏面板' : '顯示面板'}</button>{panels && <div className="layer-card"><span className="eyebrow">MAP LAYERS</span>{layers.map(([id, title, unit]) => <button key={id} className={mode === id ? 'chosen' : ''} onClick={() => setMode(id)}><span>{title}</span><small>{unit}</small></button>)}<div className="switches"><label><input type="checkbox" checked={boundaries} onChange={e => setBoundaries(e.target.checked)}/> 縣市界</label><label><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)}/> 數值標籤／風向箭頭</label></div></div>}
        {selected && <div className="station-card"><button className="close" onClick={() => setSelected(null)}>×</button><small>測站觀測 · {selected.station_id}</small><h3>{selected.name}</h3><p>{selected.county} {selected.town}</p><strong>{fmt(selected.temperature, '°C')}</strong><div className="details"><span>雨量 {fmt(selected.precipitation, ' mm')}</span><span>濕度 {fmt(selected.humidity, '%')}</span><span>風速 {fmt(selected.wind_speed, ' m/s')}</span><span>風向 {fmt(selected.wind_direction, '°')}</span></div><footer>{clock(selected.observed_at)} · {freshness(selected.observed_at)}</footer></div>}
        <div className="map-actions-floating"><button disabled={busy} onClick={refresh}>{busy ? '同步中…' : '↻ 更新資料'}</button><button onClick={locate}>◎ 附近測站</button><button onClick={() => setBase(base === 'dark' ? 'street' : 'dark')}>{base === 'dark' ? '街道底圖' : '深色底圖'}</button></div>
        {['precipitation','humidity','wind_speed','radar'].includes(mode) && <div className="map-legend"><b>{layers.find(x => x[0] === mode)?.[1]} · {mode === 'radar' ? 'dBZ' : layers.find(x => x[0] === mode)?.[2]}</b><div className="legend-gradient" style={{background:mode === 'humidity' ? 'linear-gradient(90deg,#dfc27d,#c8ebe4,#5aafa6,#096c69)' : mode === 'radar' ? 'linear-gradient(90deg,cyan,blue,lime,yellow,red,magenta)' : mode === 'wind_speed' ? 'linear-gradient(90deg,#4c7fb6,#8bc1d7,#d2e6d0,#ffd880,#ff8745,#d72f25)' : 'linear-gradient(90deg,#c0e7dc,#72c4b8,#249dbb,#2290b4,#ffda82,#fb7c40,#a50045)'}}/><div className="legend-ticks">{(mode === 'precipitation' ? [1,5,10,20,40,80,130] : mode === 'humidity' ? [40,60,75,90] : mode === 'radar' ? [0,10,20,30,40,50,65] : [2,5,8,11,14,17]).map(x => <span key={x}>{x}</span>)}</div><small>{mode === 'precipitation' ? '當日累積雨量・測站周圍 20 km 內插值' : mode === 'wind_speed' ? windGrid.length ? `NOAA GFS 10 m・${clock(windGrid[0]?.valid_at)}（預報）` : '尚無 GFS・目前為測站附近觀測插值' : mode === 'humidity' ? '灰色圓點：缺值' : '官方回波色階・非地面雨量'}</small></div>}
        {mode === 'typhoon' && <div className="map-legend"><b>颱風路徑</b><p>實線：歷史分析　虛線：預報</p><p>黃色範圍：70% 半徑連接包絡</p><p>實圈：15／25 m/s 平均暴風半徑（km）</p></div>}
        {((mode === 'radar' && radarFrames.length > 0) || (mode === 'typhoon' && stormTimes.length > 0)) && <div className="timeline"><button onClick={() => setPlaying(!playing)} aria-label={playing ? '暫停' : '播放'}>{playing ? 'Ⅱ' : '▶'}</button><div><strong>{mode === 'radar' ? '雷達回波' : `${storm?.name || ''} ${storm?.wind_speed == null ? '' : storm.wind_speed < 17.2 ? '熱帶性低氣壓' : storm.wind_speed < 32.7 ? '輕度颱風' : storm.wind_speed < 50.9 ? '中度颱風' : '強烈颱風'} · ${storm?.kind === 'analysis' ? '實測' : '預報'}`}</strong><input type="range" aria-label="圖層時間" min="0" max={(mode === 'radar' ? radarFrames.length : stormTimes.length)-1} value={mode === 'radar' ? frameIndex : stormIndex} onChange={e => {setPlaying(false);mode === 'radar' ? setFrameIndex(+e.target.value) : setStormIndex(+e.target.value)}}/><small>{clock(mode === 'radar' ? radarFrames[frameIndex]?.observed_at : stormTimes[stormIndex])}{mode === 'typhoon' && ` · ${fmt(storm?.wind_speed,' m/s')} · ${fmt(storm?.pressure,' hPa')}`}</small></div></div>}
        {notice && !panels && <div className="map-alert" role="status">{notice}</div>}{error && <div className="map-alert" role="alert">{error}</div>}
        <div className="map-foot">{mode === 'radar' ? `中央氣象署雷達合成回波 · ${clock(radarFrames[frameIndex]?.observed_at)}` : mode === 'earthquake' ? `最近顯著有感地震 ${earthquakes.length} 筆` : mode === 'typhoon' ? `${new Set(typhoonPoints.map(x => x.name)).size} 個活動熱帶氣旋` : '觀測：中央氣象署 O-A0003-001 · 地圖數值依測站而異'}</div>
      </div></> : <div className="analysis-page"><span className="eyebrow">FORECAST ACCOUNTABILITY / 02</span><h2>預報與實測，<br/><em>差了多少？</em></h2>      <div className="section-label">行政區預報 <span>未來 3 天</span></div>
      <select value={county} onChange={e => { setCounty(e.target.value); setTown('') }} aria-label="選擇縣市"><option value="">選擇縣市</option>{counties.map(x => <option key={x}>{x}</option>)}</select>
      <select value={town} onChange={e => setTown(e.target.value)} aria-label="選擇鄉鎮" disabled={!county}><option value="">選擇鄉鎮市區</option>{towns.map(x => <option key={x}>{x}</option>)}</select>
<button className="refresh-button" disabled={busy} onClick={refresh}>{busy ? '同步中…' : '↻ 更新資料'}</button>{notice && <p role="status">{notice}</p>}<p>每個目標時間採用事前最後一版預報，對照代表測站最近的逐時觀測（限 ±30 分鐘）。</p>
      {!selectedLocation ? <div className="empty">請選擇縣市與鄉鎮市區。</div> : <><div className="place-line"><span>{county} / {town}</span><small>預報取得：{clock(forecast.issued_at)}</small></div>
        <div className="analysis-cards"><div><small>代表測站</small><strong>{analysis?.station_id || '尚未配對'}</strong></div><div><small>有效配對</small><strong>{analysis?.sample_count ?? 0} <span>筆</span></strong></div><div><small>平均絕對誤差 MAE</small><strong>{analysis?.mae == null ? '待累積' : fmt(analysis.mae)} {analysis?.mae != null && <span>°C</span>}</strong></div></div>
        <h3>未來預報</h3>{forecast.forecasts.length ? <div className="forecast-table-wrap"><table className="forecast-table"><thead><tr>{['時間','溫度','體感溫度','濕度','降雨機率','天氣情況'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{forecast.forecasts.filter(x => x.kind === 'point').map(x => <tr key={x.start_at}><td>{forecastClock(x.start_at)}</td><td>{fmt(x.temperature, '°C')}</td><td>{fmt(x.apparent_temperature, '°C')}</td><td>{fmt(x.humidity, '%')}</td><td>{fmt(x.pop, '%')}</td><td><span className="weather-symbol" role="img" aria-label={x.weather || '缺值'} title={x.weather || '缺值'}>{weatherSymbol(x.weather)}</span></td></tr>)}</tbody></table></div> : <div className="empty">尚無此行政區預報，請同步資料。</div>}
        <h3>預報驗證</h3>{analysis?.reason && analysis?.pairs?.length > 0 && <p>{analysis.reason}</p>}{!analysis?.available ? <div className="empty">此行政區尚無合適代表測站，因此不提供準確度分析。</div> : analysis.pairs.length ? <div className="pair-list"><div className="pair-heading"><span>目標時間</span><span>預報</span><span>實測</span><span>絕對誤差</span></div>{analysis.pairs.map(x => <div key={x.target_time}><span>{clock(x.target_time)}</span><span>{x.forecast_temperature}°C</span><span>{x.observed_temperature}°C</span><strong>{x.absolute_error}°C</strong></div>)}</div> : <div className="empty">{analysis.reason || '等待取得可配對的預報與觀測資料。'}</div>}</>}
      </div>}</section></main><footer className="site-footer">資料來源：中央氣象署／NOAA GFS · 地圖 © OpenStreetMap / Esri · 教學作品</footer>
  </div>
}
