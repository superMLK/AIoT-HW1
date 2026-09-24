import React, { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'

const layers = [
  ['temperature', '氣溫', '°C'], ['precipitation', '雨量', 'mm'],
  ['humidity', '濕度', '%'], ['wind_speed', '風速與風向', 'm/s'],
  ['weather', '天氣現象', ''], ['radar', '雷達回波', ''],
  ['typhoon', '颱風路徑', ''], ['earthquake', '最近地震', '']
]
const RADAR_URL = 'https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-005.png'
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

function WeatherMap({ stations, earthquakes, typhoonPoints, mode, base, boundaries, labels, onSelect }) {
  const element = useRef(null), map = useRef(null), tile = useRef(null), drawn = useRef(null), border = useRef(null)
  const [zoom, setZoom] = useState(7)
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
    if (mode === 'radar') {
      L.imageOverlay(RADAR_URL, [[17.75, 115], [29.25, 126.5]], { opacity: 0.65, errorOverlayUrl: '' }).addTo(drawn.current)
    }
    if (mode === 'typhoon') {
      const names = [...new Set(typhoonPoints.map(x => x.name))]
      for (const name of names) {
        for (const kind of ['analysis', 'forecast']) {
          const fixes = typhoonPoints.filter(x => x.name === name && x.kind === kind)
          if (fixes.length > 1) L.polyline(fixes.map(x => [x.latitude, x.longitude]), {
            color: kind === 'analysis' ? '#fdaf70' : '#9fcbff', weight: 3, dashArray: kind === 'forecast' ? '5 8' : null
          }).addTo(drawn.current)
          fixes.forEach(fix => L.circleMarker([fix.latitude, fix.longitude], { radius: 5,
            color: kind === 'analysis' ? '#fdaf70' : '#9fcbff', fillOpacity: 1 })
            .bindPopup(`${name}｜${kind === 'analysis' ? '實際' : '預報'}<br>${clock(fix.valid_at)}`).addTo(drawn.current))
        }
      }
    }
    if (mode === 'earthquake') earthquakes.forEach(x => L.circleMarker([x.latitude, x.longitude], {
      radius: Math.max(7, (x.magnitude || 3) * 3), color: '#ffb089', fillColor: '#f17b55', fillOpacity: .45
    }).bindPopup(`<strong>規模 ${fmt(x.magnitude)}</strong><br>${x.location || ''}<br>${clock(x.origin_at)}<br>深度 ${fmt(x.depth_km, ' km')}`)
      .addTo(drawn.current))
    let visibleStations = stations
    if (zoom < 9) {
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
    if (!['earthquake', 'typhoon'].includes(mode)) visibleStations.forEach(station => {
      if (station.latitude == null || station.longitude == null) return
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
  }, [stations, earthquakes, typhoonPoints, mode, labels, onSelect, zoom])
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
  const [tab, setTab] = useState('map'), [token, setToken] = useState(''), [busy, setBusy] = useState(false)
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
      const [s, l, w, e, t] = await Promise.all([
        get('stations'), get('locations'), get('warnings'), get('earthquakes'), get('typhoons')
      ])
      setStations(s.stations); setLocations(l.locations); setWarnings(w.warnings)
      setWarningStatus(w.status); setEarthquakes(e.earthquakes); setTyphoonPoints(t.points)
      setError('')
    } catch (err) { setError(`讀取失敗：${err.message}`) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!selectedLocation) { setForecast({ forecasts: [], issued_at: null }); setAnalysis(null); return }
    Promise.all([get(`forecast?location_id=${selectedLocation.id}`), get(`analysis?location_id=${selectedLocation.id}`)])
      .then(([f, a]) => { setForecast(f); setAnalysis(a) }).catch(err => setError(err.message))
  }, [selectedLocation?.id])
  async function refresh() {
    if (!token) { setNotice('請輸入維護者更新密鑰，才可要求伺服器同步。'); return }
    setBusy(true); setNotice('正在同步資料…')
    const datasets = ['O-A0003-001', 'O-A0001-001', 'E-A0015-001', 'W-C0034-005', 'warnings']
    if (county) {
      const index = ['宜蘭縣','桃園市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','臺東縣','花蓮縣','澎湖縣','基隆市','新竹市','嘉義市','臺北市','高雄市','新北市','臺中市','臺南市','連江縣','金門縣'].indexOf(county)
      if (index >= 0) datasets.push(`F-D0047-${String(index * 4 + 1).padStart(3, '0')}`)
    }
    const outcomes = []
    for (const dataset of datasets) {
      try {
        const response = await fetch(`/api/refresh?dataset=${dataset}`, { method: 'POST', headers: { 'X-Refresh-Token': token } })
        const value = await response.json()
        outcomes.push(`${dataset}: ${response.ok ? value.received + ' 筆' : '失敗'}`)
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
      const st = stations.reduce((best, x) => {
        const distance = (x.latitude - position.coords.latitude) ** 2 + (x.longitude - position.coords.longitude) ** 2
        return !best || distance < best.distance ? { station: x, distance } : best
      }, null)
      if (st) setSelected(st.station)
    }, () => setNotice('未取得定位權限，仍可手動選擇測站。'))
  }
  return <div className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">◈</span><div><strong>島嶼天氣誌</strong><small>TAIWAN WEATHER ATLAS</small></div></div>
      <nav><button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>觀測地圖</button><button className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}>預報驗證</button></nav>
      <span className="live"><i />{freshness(latestTime)}</span></header>
    <main><aside className="sidebar"><div className="eyebrow">LIVE CONDITIONS / 01</div><h1>此刻，<br/><em>島上的天氣</em></h1>
      <p className="intro">從測站看見正在發生的事，也檢查預報與實際相差多少。</p>
      <div className="section-label">資料概況 <span>氣象署觀測</span></div>
      <div className="stat-grid"><div><small>目前測站</small><strong>{stations.length}</strong><span>站</span></div><div><small>有效氣溫</small><strong>{available.length}</strong><span>站</span></div><div><small>最高氣溫</small><strong>{fmt(maxStation?.temperature)}</strong><span>°C · {maxStation?.county || '—'}</span></div><div><small>最低氣溫</small><strong>{fmt(minStation?.temperature)}</strong><span>°C · {minStation?.county || '—'}</span></div></div>
      <div className="time-note">觀測時間：{clock(latestTime)}<br/>更新頻率依氣象署資料發布為準</div>
      <div className="section-label">行政區預報 <span>未來 3 天</span></div>
      <select value={county} onChange={e => { setCounty(e.target.value); setTown('') }} aria-label="選擇縣市"><option value="">選擇縣市</option>{counties.map(x => <option key={x}>{x}</option>)}</select>
      <select value={town} onChange={e => setTown(e.target.value)} aria-label="選擇鄉鎮" disabled={!county}><option value="">選擇鄉鎮市區</option>{towns.map(x => <option key={x}>{x}</option>)}</select>
      <div className="section-label">天氣特報 <span>網站擷取</span></div>
      <div className="warning-box">{warningStatus?.status !== 'ok' ? '特報網站尚未同步；不能判定目前無特報。' : warnings.length ? warnings.map(w => <a key={w.code} href={w.source_url} target="_blank" rel="noreferrer">● {w.title} ↗</a>) : '目前未偵測到有效特報。'}<small>來源：中央氣象署公開網站 · {clock(warningStatus?.checked_at)}</small></div>
      <details className="maintenance"><summary>資料維護與手動更新</summary><input type="password" placeholder="維護者更新密鑰" value={token} onChange={e => setToken(e.target.value)}/><button disabled={busy} onClick={refresh}>{busy ? '同步中…' : '更新資料'}</button><small>選擇縣市後，同步該縣市鄉鎮預報。</small></details>
      {notice && <div className="notice">{notice}</div>}{error && <div className="error">{error}</div>}
    </aside>
    <section className="workspace">{tab === 'map' ? <><div className="map-head"><div><span className="eyebrow">EXPLORE THE ISLAND</span><h2>{layers.find(x => x[0] === mode)?.[1]}觀測圖</h2><p>點選測站，檢視完整觀測與資料時間。</p></div><div className="map-actions"><button onClick={locate}>◎ 附近測站</button><button onClick={() => setBase(base === 'dark' ? 'street' : 'dark')}>{base === 'dark' ? '街道底圖' : '深色底圖'}</button></div></div>
      <div className="map-frame"><WeatherMap stations={stations} earthquakes={earthquakes} typhoonPoints={typhoonPoints} mode={mode} base={base} boundaries={boundaries} labels={labels} onSelect={setSelected}/>
        <div className="layer-card"><span className="eyebrow">MAP LAYERS</span>{layers.map(([id, title, unit]) => <button key={id} className={mode === id ? 'chosen' : ''} onClick={() => setMode(id)}><span>{title}</span><small>{unit}</small></button>)}<div className="switches"><label><input type="checkbox" checked={boundaries} onChange={e => setBoundaries(e.target.checked)}/> 縣市界</label><label><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)}/> 數值標籤</label></div></div>
        {selected && <div className="station-card"><button className="close" onClick={() => setSelected(null)}>×</button><small>測站觀測 · {selected.station_id}</small><h3>{selected.name}</h3><p>{selected.county} {selected.town}</p><strong>{fmt(selected.temperature, '°C')}</strong><div className="details"><span>雨量 {fmt(selected.precipitation, ' mm')}</span><span>濕度 {fmt(selected.humidity, '%')}</span><span>風速 {fmt(selected.wind_speed, ' m/s')}</span><span>風向 {fmt(selected.wind_direction, '°')}</span></div><footer>{clock(selected.observed_at)} · {freshness(selected.observed_at)}</footer></div>}
        <div className="map-foot">{mode === 'radar' ? '雷達：中央氣象署 O-A0058-005，影像直接取自官方公開檔案；實際影像時間未提供。' : mode === 'earthquake' ? `最近顯著有感地震 ${earthquakes.length} 筆` : mode === 'typhoon' ? `${new Set(typhoonPoints.map(x => x.name)).size} 個活動熱帶氣旋` : '觀測：中央氣象署 O-A0003-001 · 地圖數值依測站而異'}</div>
      </div></> : <div className="analysis-page"><span className="eyebrow">FORECAST ACCOUNTABILITY / 02</span><h2>預報與實測，<br/><em>差了多少？</em></h2><p>每個目標時間採用事前最後一版預報，對照代表測站最近的逐時觀測（限 ±30 分鐘）。</p>
      {!selectedLocation ? <div className="empty">請在左側選擇縣市與鄉鎮市區。</div> : <><div className="place-line"><span>{county} / {town}</span><small>預報取得：{clock(forecast.issued_at)}</small></div>
        <div className="analysis-cards"><div><small>代表測站</small><strong>{analysis?.station_id || '尚未配對'}</strong></div><div><small>有效配對</small><strong>{analysis?.sample_count ?? 0} <span>筆</span></strong></div><div><small>平均絕對誤差 MAE</small><strong>{fmt(analysis?.mae)} <span>°C</span></strong></div></div>
        <h3>未來預報</h3>{forecast.forecasts.length ? <div className="forecast-list">{forecast.forecasts.filter(x => x.kind === 'point').slice(0, 20).map((x, i) => <div key={`${x.start_at}-${i}`}><time>{clock(x.start_at)}</time><b>{fmt(x.temperature, '°C')}</b><span>體感 {fmt(x.apparent_temperature, '°C')}</span><span>濕度 {fmt(x.humidity, '%')}</span><span>降雨 {fmt(x.pop, '%')}</span><small>{x.weather || '—'}</small></div>)}</div> : <div className="empty">尚無此行政區預報，請同步資料。</div>}
        <h3>預報驗證</h3>{!analysis?.available ? <div className="empty">此行政區尚無合適代表測站，因此不提供準確度分析。</div> : analysis.pairs.length ? <div className="pair-list"><div className="pair-heading"><span>目標時間</span><span>預報</span><span>實測</span><span>絕對誤差</span></div>{analysis.pairs.map(x => <div key={x.target_time}><span>{clock(x.target_time)}</span><span>{x.forecast_temperature}°C</span><span>{x.observed_temperature}°C</span><strong>{x.absolute_error}°C</strong></div>)}</div> : <div className="empty">已有代表測站；需等預報目標時間過去，並收集到對應逐時觀測後，才能產生誤差與 MAE。</div>}</>}
      </div>}</section></main><footer className="site-footer">資料來源：中央氣象署開放資料與公開警特報網站 · 地圖 © OpenStreetMap / Esri · 教學作品</footer>
  </div>
}
