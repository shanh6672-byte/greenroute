/**
 * CVRP 多车调度模块 — 独立标签页
 */
window._cvrpData = null;
const CVRP_COLORS = ['#D32F2F','#1976D2','#388E3C','#7B1FA2','#E64A19','#00796C','#C62828','#1565C0'];
let cvrpLayers = [];

// 固废产量 (吨/天)
const WASTE_MAP = {
  '奥林匹克森林公园':8.0,'奥林匹克公园':5.5,'朝阳公园':5.0,'圆明园':5.0,'颐和园':4.5,
  '温榆河公园':4.0,'将府公园':2.5,'太阳宫公园':2.0,'红领巾公园':1.8,'日坛公园':1.5,
  '望京公园':1.2,'团结湖公园':1.0,'金铃狮园':0.9,'四得公园':0.8,'北小河公园':1.5,
  '望和公园':1.2,'朝来森林公园':1.8,'东坝公园':1.5,'常营公园':1.3,'古塔公园':1.1,
  '京城梨园':1.0,'兴隆公园':1.6,'望湖公园':0.9,'元大都城垣遗址公园':2.0,
  '东风公园':1.2,'金盏森林公园':2.0,'玉渊潭公园':3.0,'陶然亭公园':2.2,
};

function initCVRPPanel() {
  const parks = (window._getParks && window._getParks()) || [];
  console.log('initCVRPPanel: parks.length =', parks.length);
  if (parks.length === 0) { setTimeout(initCVRPPanel, 500); return; }
  const html = parks.map((p, i) => {
    const w = (WASTE_MAP[p.name] || 0.5).toFixed(1);
    return `<label class="cvrp-row" id="cvrpRow${i}">
      <input type="checkbox" data-idx="${i}" data-waste="${w}" onchange="window._updateCVRPCount()">
      <span class="cvrp-name" title="${p.name}">${p.name.length>10?p.name.slice(0,9)+'..':p.name}</span>
      <input class="cvrp-ton" type="number" value="${w}" step="0.1" min="0.1" max="50"
             onchange="window._updateCVRPCount()" onfocus="this.select()">
      <span>吨</span>
    </label>`;
  }).join('');
  document.getElementById('cvrpParkList').innerHTML = html;
}

window._selectAllParks = function() {
  document.querySelectorAll('#cvrpParkList input[type=checkbox]').forEach(cb => cb.checked = true);
  window._updateCVRPCount();
};
window._selectTopParks = function() {
  // 按废品量从大到小排序，选前20
  const items = [];
  document.querySelectorAll('#cvrpParkList input[type=checkbox]').forEach(cb => {
    items.push({ cb, waste: parseFloat(cb.dataset.waste) || 0 });
  });
  items.sort((a, b) => b.waste - a.waste);
  items.forEach((item, i) => { item.cb.checked = i < 20; });
  window._updateCVRPCount();
};
window._clearParks = function() {
  document.querySelectorAll('#cvrpParkList input[type=checkbox]').forEach(cb => cb.checked = false);
  window._updateCVRPCount();
};
window._updateCVRPCount = function() {
  let count = 0, total = 0;
  document.querySelectorAll('#cvrpParkList .cvrp-row').forEach(row => {
    const cb = row.querySelector('input[type=checkbox]');
    const tonInput = row.querySelector('.cvrp-ton');
    if (cb && cb.checked) {
      count++;
      total += parseFloat(tonInput.value) || parseFloat(cb.dataset.waste) || 0.5;
    }
  });
  const btn = document.getElementById('btnCVRPSolve');
  if (btn) btn.textContent = '🚛 求解最优调度方案 (' + count + '站点/' + total.toFixed(1) + '吨)';
};

// 消纳点容量 (吨)
const DISP_CAP = {
  '高安屯垃圾填埋场':60,'小武基大型固废垃圾转运站':40,'大屯垃圾转运站':30,
  '朝环三清场酒仙桥有机生物处理站':30,'朝阳生活垃圾焚烧中心':30,
};

window._solveCVRP = async function() {
  const btn = document.getElementById('btnCVRPSolve');
  btn.textContent = '⏳ 计算中...'; btn.disabled = true;

  const parks = (window._getParks && window._getParks()) || [];
  const disposals = (window._getDisposals && window._getDisposals()) || [];

  // 收集选中的站点
  const selected = [];
  document.querySelectorAll('#cvrpParkList .cvrp-row').forEach(row => {
    const cb = row.querySelector('input[type=checkbox]');
    const tonInput = row.querySelector('.cvrp-ton');
    if (cb && cb.checked) {
      const idx = parseInt(cb.dataset.idx);
      const wasteTons = parseFloat(tonInput.value) || parseFloat(cb.dataset.waste) || 0.5;
      if (parks[idx]) {
        selected.push({ ...parks[idx], waste: wasteTons * 1000 }); // 吨→kg
      }
    }
  });
  if (selected.length === 0) { alert('请至少选择一个站点 (当前已加载' + parks.length + '个公园)'); btn.disabled = false; return; }

  const nVehicles = parseInt(document.getElementById('cvrpVehicleCount').value) || 5;
  const capacity = parseInt(document.getElementById('cvrpCapacity').value) * 1000 || 8000; // 吨→kg
  const vehicles = [];
  for (let i = 1; i <= nVehicles; i++) vehicles.push({ id: i, capacity });

  // 消纳点
  const disposalsWithCap = disposals.map(d => ({
    ...d, capacity: (DISP_CAP[d.name] || 15) * 1000
  }));

  // 贪婪分配
  const sorted = [...selected].sort((a, b) => b.waste - a.waste);
  const routes = vehicles.map(v => ({ vehicle: v, stops: [], load: 0, dispIdx: -1 }));
  const dispAvail = disposalsWithCap.map(d => d.capacity);
  const unassigned = [];

  sorted.forEach(park => {
    let bestVeh = -1, bestDisp = -1, bestCost = Infinity;
    for (let vi = 0; vi < routes.length; vi++) {
      const r = routes[vi];
      if (r.vehicle.capacity - r.load < park.waste) continue;
      for (let di = 0; di < disposalsWithCap.length; di++) {
        if (dispAvail[di] < park.waste) continue;
        const d = disposalsWithCap[di];
        const dist = haversine(park.lng, park.lat, d.lng, d.lat);
        const timeMin = dist/35*60;
        const cost = 0.42*dist/50 + 0.23*timeMin/90 + 0.12*(dist*0.2)/10 + 0.23*(dist*1.2)/60;
        if (cost < bestCost) { bestCost = cost; bestVeh = vi; bestDisp = di; }
      }
    }
    if (bestVeh >= 0 && bestDisp >= 0) {
      routes[bestVeh].stops.push(park);
      routes[bestVeh].load += park.waste;
      routes[bestVeh].dispIdx = bestDisp;
      dispAvail[bestDisp] -= park.waste;
    } else { unassigned.push(park); }
  });

  // 清除旧图层
  cvrpLayers.forEach(l => { if(l.polyline)l.polyline.setMap(null); l.markers.forEach(m=>m.setMap(null)); });
  cvrpLayers = [];
  if (window._getMap) window._getMap().clearMap();
  if (window._addAllMarkers) window._addAllMarkers();

  const usedRoutes = routes.filter(r => r.stops.length > 0);
  let totalDist = 0, totalLoad = 0;
  const summaryRows = [];

  for (let ri = 0; ri < usedRoutes.length; ri++) {
    const route = usedRoutes[ri];
    const disp = disposalsWithCap[route.dispIdx];
    const color = CVRP_COLORS[ri % CVRP_COLORS.length];
    const allCoords = [];
    let prevPoint = null;

    const maxSegs = 5;
    const stopsToRoute = route.stops.slice(0, maxSegs + 1);
    for (const stop of stopsToRoute) {
      if (prevPoint) {
        btn.textContent = '⏳ 车' + route.vehicle.id + ' 路径...';
        const coords = await fetchRouteCoords(prevPoint, stop);
        if (coords.length > 0) allCoords.push(...coords);
        else { allCoords.push([prevPoint.lng,prevPoint.lat]); allCoords.push([stop.lng,stop.lat]); }
      }
      prevPoint = stop;
      totalLoad += stop.waste;
    }
    if (prevPoint && disp) {
      const coords = await fetchRouteCoords(prevPoint, disp);
      if (coords.length > 0) allCoords.push(...coords);
      else { allCoords.push([prevPoint.lng,prevPoint.lat]); allCoords.push([disp.lng,disp.lat]); }
      totalDist += haversine(prevPoint.lng, prevPoint.lat, disp.lng, disp.lat);
    }

    const polyline = new AMap.Polyline({
      path: allCoords, strokeColor: color, strokeWeight: 5,
      strokeOpacity: 0.7, lineJoin: 'round',
    });
    if (window._getMap) polyline.setMap(window._getMap());

    const markers = [];
    route.stops.forEach((stop, si) => {
      if (si < maxSegs + 1) {
        const label = stop.name.length > 4 ? stop.name.slice(0,4) : stop.name;
        const m = new AMap.Marker({
          position: [stop.lng, stop.lat],
          label: { content: label, direction: 'top', offset: new AMap.Pixel(0,-5),
                   style: { fontSize:'10px', color:color, fontWeight:'bold', background:'rgba(255,255,255,0.85)', padding:'1px 3px', borderRadius:'2px' } },
          icon: new AMap.Icon({ size: new AMap.Size(14,14), image: circleIcon(color), imageSize: new AMap.Size(14,14) }),
        });
        if (window._getMap) m.setMap(window._getMap());
        markers.push(m);
      }
    });

    cvrpLayers.push({ vehicleId: route.vehicle.id, polyline, markers, visible: true, color });

    summaryRows.push({
      vehicle: route.vehicle.id, color, stops: route.stops.length,
      load: route.load, capacity: route.vehicle.capacity,
      util: Math.min((route.load/route.vehicle.capacity*100), 100).toFixed(0),
      overCap: route.load > route.vehicle.capacity,
      disposal: disp ? disp.name : '?',
    });
  }

  // 面板
  const overlay = document.getElementById('mapOverlay');
  const compare = document.getElementById('routeCompare');
  if (overlay) overlay.classList.remove('hidden');
  if (compare) compare.innerHTML = `
    <div class="overlay-header"><span>🚛 调度方案 (${usedRoutes.length}车)</span></div>
    ${summaryRows.map((r, i) => {
      const stops = usedRoutes[i].stops.slice(0, 8);
      const stopNames = stops.map(s => s.name.length > 4 ? s.name.slice(0,4)+'..' : s.name).join(' → ');
      const more = usedRoutes[i].stops.length > 8 ? ' +'+(usedRoutes[i].stops.length-8)+'站' : '';
      return `
      <div class="route-card cvrp-card" style="border-left:4px solid ${r.color}" onclick="window._toggleCVRPVehicle(${i})">
        <div class="route-title">
          <span class="cvrp-dot" style="background:${r.color}"></span>
          车${r.vehicle} → ${r.disposal}
        </div>
        <div class="route-meta" style="font-size:10px;line-height:1.4;word-break:break-all">
          ${stopNames}${more}
        </div>
        <div class="route-meta">
          ${(r.load/1000).toFixed(1)}/${(r.capacity/1000).toFixed(0)}吨 (${r.util}%)
          ${r.overCap ? ' <b style=color:red>超载!</b>' : ''}
        </div>
      </div>`;
    }).join('')}
    <div id="cvrpPathDetail" style="padding:8px 14px;font-size:11px;color:var(--text-sec);line-height:1.5;
         border-bottom:1px solid var(--border);background:#FAFAFA">
      👆 点击上方车辆卡片查看完整路线
    </div>
    <div class="route-card" style="background:#F5F5F5">
      <b>总计: ${usedRoutes.length}车 | ${(totalLoad/1000).toFixed(0)}吨 | ~${totalDist|0}km</b>
      ${unassigned.length > 0 ? ' | <span style=color:red>'+unassigned.length+'站点未分配</span>' : ''}
    </div>
  `;

  const bar = document.getElementById('resultBar');
  if (bar) bar.classList.remove('hidden');
  const resIds = ['resDistance','resTime','resCO2','resFuel','resScore','resCongestion'];
  resIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  const elDist = document.getElementById('resDistance'); if (elDist) elDist.textContent = '~'+(totalDist|0)+' km';
  const elScore = document.getElementById('resScore'); if (elScore) elScore.textContent = usedRoutes.length+' 辆车';

  window._cvrpData = { summaryRows, usedRoutes };
  btn.textContent = '🚛 求解最优调度方案';
  btn.disabled = false;
};

window._toggleCVRPVehicle = function(idx) {
  const map = window._getMap && window._getMap();
  // 只显示选中的车, 隐藏其他
  cvrpLayers.forEach((layer, i) => {
    if (!layer) return;
    const show = (i === idx);
    layer.visible = show;
    if (map) {
      if (show) { layer.polyline.setMap(map); layer.markers.forEach(m => m.setMap(map)); }
      else { layer.polyline.setMap(null); layer.markers.forEach(m => m.setMap(null)); }
    }
  });
  // 更新卡片高亮
  const cards = document.querySelectorAll('.cvrp-card');
  cards.forEach((card, i) => {
    card.style.opacity = i === idx ? '1' : '0.35';
    card.style.background = i === idx ? '#E8F5E9' : '';
  });

  // 展开显示完整路径
  if (window._cvrpData && window._cvrpData.summaryRows) {
    const row = window._cvrpData.summaryRows[idx];
    const route = window._cvrpData.usedRoutes && window._cvrpData.usedRoutes[idx];
    if (row && route) {
      const pathStr = route.stops.map(s => s.name).join(' → ') + ' → ' + row.disposal;
      const el = document.getElementById('cvrpPathDetail');
      if (el) el.textContent = '🚛 车' + row.vehicle + ': ' + pathStr;
      const elDist = document.getElementById('resDistance');
      const elScore = document.getElementById('resScore');
      const elTime = document.getElementById('resTime');
      if (elDist) elDist.textContent = '车'+row.vehicle+' | ' + row.stops + '站';
      if (elScore) elScore.textContent = (row.load/1000).toFixed(1)+' 吨';
      if (elTime) elTime.textContent = row.util + '% 利用率';
    }
  }
};

function haversine(lng1, lat1, lng2, lat2) {
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

let _cvrpTimer = null;
function fetchRouteCoords(from, to) {
  return new Promise((resolve) => {
    const cb='_cv_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    if (_cvrpTimer) clearTimeout(_cvrpTimer);
    window[cb]=function(data){
      delete window[cb];
      const coords=[];
      try {
        if(data&&data.route&&data.route.paths&&data.route.paths[0]){
          data.route.paths[0].steps.forEach(s=>{
            (s.polyline||'').split(';').forEach(p=>{
              const [lng,lat]=p.split(',').map(Number);
              if(!isNaN(lng))coords.push([lng,lat]);
            });
          });
        }
      }catch(e){}
      resolve(coords.length>0?coords:[]);
    };
    const s=document.createElement('script');
    s.src='https://restapi.amap.com/v3/direction/driving?key=eb6fd67c6315d8e306616259ee6d8e3b&origin='+from.lng+','+from.lat+'&destination='+to.lng+','+to.lat+'&extensions=all&output=JSON&callback='+cb;
    s.onerror=()=>{delete window[cb];resolve([])};
    document.head.appendChild(s);
    _cvrpTimer=setTimeout(()=>{if(s.parentNode)s.remove();delete window[cb];resolve([])},10000);
  });
}

function circleIcon(color) {
  const c=document.createElement('canvas');c.width=16;c.height=16;
  const ctx=c.getContext('2d');ctx.beginPath();ctx.arc(8,8,7,0,Math.PI*2);
  ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  return c.toDataURL();
}
