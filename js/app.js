/**
 * GreenRoute — 主应用逻辑 v2
 * 高德地图 + AHP 多准则路径优化
 */
(function () {
  'use strict';

  const STATE = {
    map: null,
    driving: null,
    parks: [],
    disposals: [],
    origin: null,
    dest: null,
    picking: null,
    currentWeights: AHP.factors.map(f => f.defaultW),
    currentRoutes: null,
    bestRouteIdx: 0,
    pluginReady: false,
    weather: { temp: 20, humidity: 50, wind: 3, visib: 8, weather: '晴', index: 0.15 },
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const DOM = {
    originSelect: $('#originSelect'), destSelect: $('#destSelect'),
    sliders: $('#sliders'), weightSum: $('#weightSum'),
    btnCalculate: $('#btnCalculate'), btnReset: $('#btnReset'),
    btnPickOrigin: $('#btnPickOrigin'), btnPickDest: $('#btnPickDest'),
    mapOverlay: $('#mapOverlay'), routeCompare: $('#routeCompare'),
    resultBar: $('#resultBar'), trafficStatus: $('#trafficStatus'),
  };

  // ==================== 滑块 ====================
  function buildSliders() {
    DOM.sliders.innerHTML = AHP.factors.map((f, i) => `
      <div class="slider-group">
        <div class="slider-header">
          <span class="slider-name">${f.name}</span>
          <span class="slider-value" id="val_${f.key}">${f.defaultW.toFixed(1)}%</span>
        </div>
        <input type="range" min="0" max="100" step="0.5" value="${f.defaultW}" id="slider_${f.key}">
      </div>`).join('');
    $$('#sliders input[type=range]').forEach(s => s.addEventListener('input', onSliderChange));
  }

  function onSliderChange() {
    const w = Array.from($$('#sliders input[type=range]')).map(s => parseFloat(s.value));
    STATE.currentWeights = AHP.normalize(w);
    AHP.factors.forEach((f, i) => {
      const el = document.getElementById('val_' + f.key);
      const sl = document.getElementById('slider_' + f.key);
      if (el) el.textContent = STATE.currentWeights[i].toFixed(1) + '%';
      if (sl) sl.value = STATE.currentWeights[i];
    });
    const sum = STATE.currentWeights.reduce((a, b) => a + b, 0);
    DOM.weightSum.textContent = sum.toFixed(1) + '%';
    DOM.weightSum.style.color = Math.abs(sum - 100) < 0.5 ? 'var(--primary)' : '#C00000';
  }

  function resetWeights() {
    STATE.currentWeights = AHP.factors.map(f => f.defaultW);
    AHP.factors.forEach((f, i) => {
      const el = document.getElementById('val_' + f.key);
      const sl = document.getElementById('slider_' + f.key);
      if (el) el.textContent = f.defaultW.toFixed(1) + '%';
      if (sl) sl.value = f.defaultW;
    });
    DOM.weightSum.textContent = '100.0%';
    DOM.weightSum.style.color = 'var(--primary)';
  }

  // ==================== 自定义图标 ====================
  function createTreeIcon(fill, stroke) {
    const canvas = document.createElement('canvas');
    canvas.width = 24; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    // 树干
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(10, 18, 4, 14);
    // 树冠
    ctx.beginPath();
    ctx.moveTo(12, 1);
    ctx.lineTo(22, 12);
    ctx.lineTo(18, 12);
    ctx.lineTo(23, 20);
    ctx.lineTo(14, 16);
    ctx.lineTo(15, 24);
    ctx.lineTo(9, 24);
    ctx.lineTo(10, 16);
    ctx.lineTo(1, 20);
    ctx.lineTo(6, 12);
    ctx.lineTo(2, 12);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    return new AMap.Icon({
      size: new AMap.Size(24, 32),
      image: canvas.toDataURL(),
      imageSize: new AMap.Size(24, 32),
    });
  }

  function createHouseIcon(fill, stroke) {
    const canvas = document.createElement('canvas');
    canvas.width = 28; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    // 房屋
    ctx.fillStyle = '#FFF9C4';
    ctx.fillRect(4, 12, 20, 20);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(4, 12, 20, 20);
    // 屋顶
    ctx.beginPath();
    ctx.moveTo(2, 13);
    ctx.lineTo(14, 2);
    ctx.lineTo(26, 13);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
    // 门
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(11, 22, 6, 10);
    // 回收标
    ctx.beginPath();
    ctx.arc(14, 18, 4, 0, Math.PI * 2);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, 16); ctx.lineTo(14, 14); ctx.lineTo(16, 16);
    ctx.moveTo(12, 18); ctx.lineTo(14, 16); ctx.lineTo(16, 18);
    ctx.stroke();
    return new AMap.Icon({
      size: new AMap.Size(28, 32),
      image: canvas.toDataURL(),
      imageSize: new AMap.Size(28, 32),
    });
  }

  // ==================== 地图 ====================
  function initMap() {
    STATE.map = new AMap.Map('mapContainer', {
      zoom: 10,
      center: [116.40, 39.90],
      mapStyle: 'amap://styles/light',
      resizeEnable: true,
    });
    STATE.map.addControl(new AMap.ToolBar({ position: 'LT' }));
    STATE.map.addControl(new AMap.Scale({ position: 'LB' }));

    STATE.map.on('click', function (e) {
      if (STATE.picking === 'origin') {
        setOriginByCoord(e.lnglat.getLng(), e.lnglat.getLat(), '地图选点');
      } else if (STATE.picking === 'dest') {
        setDestByCoord(e.lnglat.getLng(), e.lnglat.getLat(), '地图选点');
      }
      STATE.picking = null;
      updatePickBtn();
    });

    AMap.plugin('AMap.Driving', function () {
      STATE.driving = new AMap.Driving({
        policy: AMap.DrivingPolicy.LEAST_TIME,
        map: STATE.map,
        panel: null,
        autoFitView: true,
      });
      STATE.pluginReady = true;
      console.log('Driving plugin ready');
    });

    loadMarkers();
  }

  // ==================== 数据加载 ====================
  async function loadMarkers() {
    try {
      const [pr, dr] = await Promise.all([
        fetch('/data/parks.json'), fetch('/data/disposals.json')
      ]);
      STATE.parks = await pr.json();
      STATE.disposals = await dr.json();
    } catch (e) {
      console.warn('Fetch failed, using embedded data');
      STATE.parks = [
        { name: '朝阳公园', lng: 116.4762, lat: 39.9428 },
        { name: '太阳宫公园', lng: 116.4497, lat: 39.9742 },
        { name: '奥林匹克公园', lng: 116.3855, lat: 40.0008 },
        { name: '颐和园', lng: 116.278, lat: 39.999 },
        { name: '圆明园', lng: 116.303, lat: 40.009 },
      ];
      STATE.disposals = [
        { name: '朝环三清场酒仙桥', lng: 116.5040, lat: 39.9618 },
        { name: '高安屯垃圾填埋场', lng: 116.6147, lat: 39.9377 },
        { name: '小武基固废转运站', lng: 116.4797, lat: 39.8588 },
        { name: '大屯垃圾转运站', lng: 116.4160, lat: 40.0055 },
      ];
    }

    populateSelects();
    addAllMarkers();
    const initP = STATE.parks[DOM.originSelect.value];
    const initD = STATE.disposals[DOM.destSelect.value];
    if (initP) STATE.origin = { lng: initP.lng, lat: initP.lat, name: initP.name };
    if (initD) STATE.dest   = { lng: initD.lng,  lat: initD.lat,  name: initD.name };
  }

  function populateSelects() {
    DOM.originSelect.innerHTML = STATE.parks.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
    DOM.destSelect.innerHTML   = STATE.disposals.map((d, i) => `<option value="${i}">${d.name}</option>`).join('');
    const parkIdx = STATE.parks.findIndex(p => p.name.includes('朝阳公园'));
    DOM.originSelect.value = parkIdx >= 0 ? parkIdx : 0;
    DOM.destSelect.value = 0;
    DOM.originSelect.onchange = () => {
      const p = STATE.parks[DOM.originSelect.value];
      if (p) setOriginByCoord(p.lng, p.lat, p.name);
    };
    DOM.destSelect.onchange = () => {
      const d = STATE.disposals[DOM.destSelect.value];
      if (d) setDestByCoord(d.lng, d.lat, d.name);
    };
  }

  function addAllMarkers() {
    // 创建小绿树图标 (Canvas)
    const treeIcon = createTreeIcon('#2E7D32', '#4CAF50');
    const houseIcon = createHouseIcon('#C62828', '#E53935');

    STATE.parks.forEach(p => {
      const m = new AMap.Marker({
        position: [p.lng, p.lat], title: p.name,
        icon: treeIcon,
        offset: new AMap.Pixel(-10, -30),
        zIndex: 100,
      });
      m.on('click', () => setOriginByCoord(p.lng, p.lat, p.name));
      STATE.map.add(m);
    });
    STATE.disposals.forEach(d => {
      const m = new AMap.Marker({
        position: [d.lng, d.lat], title: d.name,
        icon: houseIcon,
        offset: new AMap.Pixel(-12, -32),
        zIndex: 100,
      });
      m.on('click', () => setDestByCoord(d.lng, d.lat, d.name));
      STATE.map.add(m);
    });
  }

  function setOriginByCoord(lng, lat, name) {
    STATE.origin = { lng, lat, name };
    const idx = STATE.parks.findIndex(p => p.name === name);
    if (idx >= 0) DOM.originSelect.value = idx;
  }
  function setDestByCoord(lng, lat, name) {
    STATE.dest = { lng, lat, name };
    const idx = STATE.disposals.findIndex(d => d.name === name);
    if (idx >= 0) DOM.destSelect.value = idx;
  }

  function updatePickBtn() {
    DOM.btnPickOrigin.style.background = STATE.picking === 'origin' ? 'var(--accent-l)' : '';
    DOM.btnPickDest.style.background   = STATE.picking === 'dest'   ? 'var(--accent-l)' : '';
    STATE.map.setDefaultCursor(STATE.picking ? 'crosshair' : 'default');
  }

  // ==================== 路径计算 (核心) ====================
  async function calculateRoute() {
    if (!STATE.origin || !STATE.dest) { alert('请先选择起点和终点'); return; }

    DOM.btnCalculate.textContent = '⏳ 计算中...';
    DOM.btnCalculate.disabled = true;

    const origin = new AMap.LngLat(STATE.origin.lng, STATE.origin.lat);
    const dest   = new AMap.LngLat(STATE.dest.lng,   STATE.dest.lat);

    try {
      // 单次搜索获取多条备选路径
      const routes = await searchAllRoutes(origin, dest);
      if (!routes || routes.length === 0) {
        alert('未找到可行路径，请更换起终点');
        return;
      }

      STATE.currentRoutes = routes;
      STATE.bestRouteIdx = 0;

      // 绘制最优路径（首次计算，自适应视野）
      drawBestOnMap(routes[0], false);

      // UI更新
      showRouteComparison(routes);
      showResults(routes[0]);
      DOM.trafficStatus.textContent = '● 实时路况已更新';
      DOM.trafficStatus.style.background = '#C8E6C9';

    } catch (e) {
      console.error(e);
      alert('查询失败: ' + (e.message || '请检查高德API Key是否已启用Web端JS API服务'));
    } finally {
      DOM.btnCalculate.textContent = '🔍 计算最优路径';
      DOM.btnCalculate.disabled = false;
    }
  }

  function searchAllRoutes(origin, dest) {
    return new Promise((resolve, reject) => {
      // 确保插件已加载
      if (!STATE.driving) {
        AMap.plugin('AMap.Driving', function () {
          STATE.driving = new AMap.Driving({
            policy: AMap.DrivingPolicy.LEAST_TIME,
            map: STATE.map,
            panel: null,
            autoFitView: false,
          });
          STATE.pluginReady = true;
          doSearch(origin, dest, resolve, reject);
        });
      } else {
        doSearch(origin, dest, resolve, reject);
      }
    });
  }

  function doSearch(origin, dest, resolve, reject) {
    // 使用服务端 REST API (更可靠)
    const originStr = origin.getLng() + ',' + origin.getLat();
    const destStr   = dest.getLng()   + ',' + dest.getLat();
    const strategies = [
      { strategy: 0,  label: '速度优先' },
      { strategy: 2,  label: '距离优先' },
    ];

    const allRoutes = [];
    let completed = 0;
    const WEB_KEY = 'eb6fd67c6315d8e306616259ee6d8e3b';

    strategies.forEach(s => {
      const url = 'https://restapi.amap.com/v3/direction/driving?key=' + WEB_KEY +
        '&origin=' + encodeURIComponent(originStr) +
        '&destination=' + encodeURIComponent(destStr) +
        '&extensions=all&strategy=' + s.strategy;
      const cb = '_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);

      window[cb] = function(data) {
        delete window[cb];
        if (data.status === '1' && data.route && data.route.paths) {
          data.route.paths.forEach((path, ri) => {
            const parsed = AHP.extractFromAmapRoute(path);
            parsed.factors.weather = STATE.weather.index;
            const wNorm = STATE.currentWeights;
            const Z = AHP.computeImpedance(wNorm, parsed.factors);
            const costs = AHP.computeCosts(parsed.distance, parsed.timeMin, parsed.speed, Z);
            const ahpCost = AHP.computeComprehensive(costs);
            allRoutes.push({
              strategy: s.label + (ri > 0 ? '备选' + ri : ''),
              raw: path, ...parsed, Z, costs, ahpCost,
            });
          });
        }
        completed++;
        if (completed >= strategies.length) {
          if (allRoutes.length === 0) reject(new Error('未找到路径'));
          else { allRoutes.sort((a, b) => a.ahpCost - b.ahpCost); resolve(allRoutes); }
        }
      };

      const script = document.createElement('script');
      script.src = url + '&output=JSON&callback=' + cb;
      script.onerror = function() { completed++; delete window[cb]; };
      document.head.appendChild(script);
      setTimeout(function() { if (script.parentNode) script.remove(); }, 10000);
    });
  }

  // 缓存地图上动态添加的对象
  const mapOverlays = { polyline: null, startMarker: null, endMarker: null };

  function drawBestOnMap(routeData, keepView) {
    // 保存当前视野
    const currentZoom = STATE.map.getZoom();
    const currentCenter = STATE.map.getCenter();

    // 清除上一次动态对象
    if (mapOverlays.polyline)   { STATE.map.remove(mapOverlays.polyline);   mapOverlays.polyline = null; }
    if (mapOverlays.startMarker) { STATE.map.remove(mapOverlays.startMarker); mapOverlays.startMarker = null; }
    if (mapOverlays.endMarker)   { STATE.map.remove(mapOverlays.endMarker);   mapOverlays.endMarker = null; }

    // 绘制新路径
    if (routeData && routeData.raw && routeData.raw.steps) {
      const pathCoords = [];
      routeData.raw.steps.forEach(step => {
        (step.polyline || '').split(';').forEach(pair => {
          const [lng, lat] = pair.split(',').map(Number);
          if (!isNaN(lng) && !isNaN(lat)) pathCoords.push([lng, lat]);
        });
      });

      if (pathCoords.length > 0) {
        mapOverlays.polyline = new AMap.Polyline({
          path: pathCoords,
          strokeColor: '#2E7D32',
          strokeWeight: 5,
          strokeOpacity: 0.75,
          lineJoin: 'round',
          lineCap: 'round',
          showDir: true,
        });
        STATE.map.add(mapOverlays.polyline);
      }
    }

    // 起点/终点标记
    mapOverlays.startMarker = new AMap.Marker({
      position: [STATE.origin.lng, STATE.origin.lat],
      label: { content: STATE.origin.name || '起点', direction: 'bottom' },
    });
    STATE.map.add(mapOverlays.startMarker);
    mapOverlays.endMarker = new AMap.Marker({
      position: [STATE.dest.lng, STATE.dest.lat],
      label: { content: STATE.dest.name || '终点', direction: 'bottom' },
    });
    STATE.map.add(mapOverlays.endMarker);

    // 仅首次计算时自适应视野, 切换策略时不做任何视野操作
    if (!keepView) {
      STATE.map.setFitView(null, false, [60, 60, 350, 60]);
    }
  }

  // ==================== 对比面板 (三策略) ====================
  function getTop3(routes) {
    // 从所有路线中选出: 速度最优, 距离最优, AHP综合最优
    const bySpeed = [...routes].sort((a, b) => a.raw.duration - b.raw.duration)[0];
    const byDist  = [...routes].sort((a, b) => a.raw.distance - b.raw.distance)[0];
    const byAHP   = routes[0]; // 已按AHP排序

    return [
      { ...byAHP,   strategy: '综合最优', badge: 'badge-ahp', icon: '⭐', tip: 'AHP加权最优' },
      { ...bySpeed, strategy: '速度优先', badge: 'badge-speed', icon: '🚀', tip: '时间最短' },
      { ...byDist,  strategy: '距离优先', badge: 'badge-dist', icon: '📏', tip: '里程最短' },
    ];
  }

  function showRouteComparison(routes) {
    const top3 = getTop3(routes);
    const bestIdx = 0; // 综合最优排第一位
    DOM.routeCompare.innerHTML = `
      <div class="overlay-header">
        <span>📊 三种策略对比</span>
        <button class="btn-refresh" onclick="window._refreshMap()">↻ 重置</button>
      </div>
      ${top3.map((r, i) => `
        <div class="route-card ${i === bestIdx ? 'best' : ''}" onclick="window._selectRoute(${i})">
          <div class="route-title">
            <span>${r.icon} ${r.strategy}</span>
            <span class="badge-strategy ${r.badge}">${r.tip}</span>
          </div>
          <div class="route-meta">
            📍 ${r.costs.distance.toFixed(1)}km &nbsp; ⏱ ${r.costs.time.toFixed(0)}min &nbsp; 🫧 CO₂${r.costs.co2.toFixed(1)}kg
          </div>
          <div class="route-meta">
            ⛽ ¥${r.costs.fuel.toFixed(1)} &nbsp; | &nbsp;
            <span style="color:var(--primary);font-weight:700">AHP: ${r.ahpCost.toFixed(3)}</span>
          </div>
        </div>
      `).join('')}
    `;
    DOM.mapOverlay.classList.remove('hidden');
  }

  window._selectRoute = function (idx) {
    STATE.bestRouteIdx = idx;
    if (STATE.currentRoutes && STATE.currentRoutes.length > 0) {
      const top3 = getTop3(STATE.currentRoutes);
      if (top3[idx]) {
        showResults(top3[idx]);
        drawBestOnMap(top3[idx], true); // 保持当前视野
        console.log('Switch to', top3[idx].strategy, 'dist:', top3[idx].costs.distance, 'time:', top3[idx].costs.time);
      }
      $$('.route-card').forEach((c, i) => c.classList.toggle('best', i === idx));
    }
  };

  window._refreshMap = function () {
    // 清除动态覆盖物
    if (mapOverlays.polyline)   { STATE.map.remove(mapOverlays.polyline);   mapOverlays.polyline = null; }
    if (mapOverlays.startMarker) { STATE.map.remove(mapOverlays.startMarker); mapOverlays.startMarker = null; }
    if (mapOverlays.endMarker)   { STATE.map.remove(mapOverlays.endMarker);   mapOverlays.endMarker = null; }
    DOM.mapOverlay.classList.add('hidden');
    DOM.resultBar.classList.add('hidden');
    STATE.currentRoutes = null;
    STATE.bestRouteIdx = 0;
    STATE.map.setZoomAndCenter(10, [116.40, 39.90]);
  };

  // ==================== 结果栏 ====================
  function showResults(routeData) {
    const c = routeData.costs;
    $('#resDistance').textContent   = c.distance.toFixed(1) + ' km';
    $('#resTime').textContent       = c.time.toFixed(0) + ' min';
    $('#resCO2').textContent        = c.co2.toFixed(1) + ' kg';
    $('#resFuel').textContent       = '¥' + c.fuel.toFixed(1);
    $('#resScore').textContent      = routeData.ahpCost.toFixed(3);
    const cong = routeData.factors.congestion;
    $('#resCongestion').textContent = cong < 0.3 ? '畅通' : cong < 0.5 ? '缓行' : cong < 0.7 ? '拥堵' : '严重拥堵';
    DOM.resultBar.classList.remove('hidden');
  }

  // ==================== 事件 ====================
  function bindEvents() {
    DOM.btnCalculate.onclick = calculateRoute;
    DOM.btnReset.onclick = resetWeights;
    DOM.btnPickOrigin.onclick = () => {
      STATE.picking = STATE.picking === 'origin' ? null : 'origin';
      updatePickBtn();
    };
    DOM.btnPickDest.onclick = () => {
      STATE.picking = STATE.picking === 'dest' ? null : 'dest';
      updatePickBtn();
    };
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.target.closest('select, input[type=range]')) calculateRoute();
    });
  }

  // ==================== 天气 ====================
  const WEATHER_ICONS = {
    '晴': '☀️', '少云': '🌤️', '晴间多云': '⛅', '多云': '☁️', '阴': '☁️',
    '小雨': '🌧️', '中雨': '🌧️', '大雨': '🌧️', '暴雨': '⛈️',
    '小雪': '🌨️', '中雪': '🌨️', '大雪': '🌨️',
    '雾': '🌫️', '霾': '🌫️', '浮尘': '🌬️', '沙尘暴': '🌬️',
  };

  async function fetchWeather() {
    try {
      const WEB_KEY = 'eb6fd67c6315d8e306616259ee6d8e3b';
      const cb = '_wcb_' + Date.now();
      const data = await new Promise((resolve) => {
        window[cb] = function(d) { delete window[cb]; resolve(d); };
        const s = document.createElement('script');
        s.src = 'https://restapi.amap.com/v3/weather/weatherInfo?key=' + WEB_KEY + '&city=110105&extensions=all&output=JSON&callback=' + cb;
        document.head.appendChild(s);
        setTimeout(function() { if (s.parentNode) s.remove(); }, 5000);
      });
      if (data.status === '1' && data.forecasts && data.forecasts[0]) {
        const f = data.forecasts[0];
        const today = f.casts[0];
        const temp = (parseInt(today.daytemp) + parseInt(today.nighttemp)) / 2;
        const weather = today.dayweather;
        const windPower = parseInt(today.daypower) || 3;
        // 从实时数据估算能见度(高德不直接返回, 根据天气类型推断)
        const visibMap = { '晴':10,'少云':9,'多云':8,'阴':7,'小雨':5,'中雨':3,'大雨':2,'雾':1,'霾':2,'雪':3 };
        const visib = visibMap[weather] || 8;
        const humidity = weather.includes('雨') ? 85 : weather.includes('雪') ? 70 : 45;

        STATE.weather = { temp, humidity, wind: windPower, visib, weather, index: 0 };
        STATE.weather.index = computeWeatherIndex(STATE.weather);
        renderWeatherWidget();
        console.log('Weather:', weather, temp+'°C', 'index:', STATE.weather.index.toFixed(3));
      }
    } catch (e) {
      console.warn('Weather fetch failed, using defaults');
      renderWeatherWidget();
    }
  }

  function computeWeatherIndex(w) {
    const tempDev = Math.abs(w.temp - 20) / 30;   // 偏离20°C的程度
    const visibBad = Math.max(0, 1 - w.visib/10);  // 能见度越低越差
    const windBad = Math.min(w.wind / 12, 1);       // 风力越大越差
    const rainBad = w.humidity > 70 ? 0.5 : w.humidity > 50 ? 0.2 : 0;
    return 0.3*rainBad + 0.25*visibBad + 0.2*windBad + 0.25*tempDev;
  }

  function renderWeatherWidget() {
    const w = STATE.weather;
    const icon = WEATHER_ICONS[w.weather] || '🌤️';
    document.getElementById('weatherWidget').innerHTML = `
      <div class="weather-main">
        <span class="weather-icon">${icon}</span>
        <span class="weather-temp">${w.temp}°C</span>
        <span class="weather-desc">${w.weather}</span>
      </div>
      <div class="weather-detail">
        <span>💧 ${w.humidity}%</span>
        <span>💨 ${w.wind}级</span>
        <span>👁 ${w.visib}km</span>
        <span>⚠️ 天气影响${(w.index*100).toFixed(0)}%</span>
      </div>`;
  }

  // ==================== 启动 ====================
  function init() {
    buildSliders();
    initMap();
    bindEvents();
    fetchWeather();
    DOM.weightSum.textContent = '100.0%';
    console.log('🌿 GreenRoute v2 已就绪');
  }

  if (window.AMap) { init(); }
  else {
    const t = setInterval(() => { if (window.AMap) { clearInterval(t); init(); } }, 200);
  }
})();
