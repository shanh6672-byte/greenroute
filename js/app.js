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
    trafficOn: false,
    trafficLayer: null,
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
    canvas.width = 18; canvas.height = 22;
    const ctx = canvas.getContext('2d');
    // 树干
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(7, 14, 3, 8);
    // 树冠
    ctx.beginPath();
    ctx.moveTo(9, 1);
    ctx.lineTo(16, 9);
    ctx.lineTo(13, 9);
    ctx.lineTo(17, 15);
    ctx.lineTo(10, 12);
    ctx.lineTo(11, 18);
    ctx.lineTo(7, 18);
    ctx.lineTo(8, 12);
    ctx.lineTo(1, 15);
    ctx.lineTo(5, 9);
    ctx.lineTo(2, 9);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    return new AMap.Icon({
      size: new AMap.Size(18, 22),
      image: canvas.toDataURL(),
      imageSize: new AMap.Size(18, 22),
    });
  }

  function createDisposalIcon() {
    const canvas = document.createElement('canvas');
    canvas.width = 18; canvas.height = 22;
    const ctx = canvas.getContext('2d');
    // 屋顶
    ctx.beginPath();
    ctx.moveTo(1, 8); ctx.lineTo(9, 1); ctx.lineTo(17, 8);
    ctx.closePath();
    ctx.fillStyle = '#C62828';
    ctx.fill();
    ctx.strokeStyle = '#8E0000';
    ctx.lineWidth = 0.8; ctx.stroke();
    // 房屋主体
    ctx.fillStyle = '#FFF9C4';
    ctx.fillRect(3, 8, 12, 12);
    ctx.strokeStyle = '#8E0000';
    ctx.strokeRect(3, 8, 12, 12);
    // 门
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(7, 13, 4, 7);
    return new AMap.Icon({
      size: new AMap.Size(18, 22),
      image: canvas.toDataURL(),
      imageSize: new AMap.Size(18, 22),
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

    // 交通路况图层
    STATE.trafficLayer = new AMap.TileLayer.Traffic({ zIndex: 20 });
    // 默认关闭，由右上角按钮切换

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
        fetch((location.pathname.replace(/\/[^/]*$/, '')) + '/data/parks.json'), fetch((location.pathname.replace(/\/[^/]*$/, '')) + '/data/disposals.json')
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
    const dispIcon = createDisposalIcon();

    STATE.parks.forEach((p, i) => {
      // 浅绿色圆形绿地标注
      const radius = 80 + (i % 3) * 40; // 80-160m 半径
      const circle = new AMap.Circle({
        center: [p.lng, p.lat],
        radius: radius,
        fillColor: '#C8E6C9',
        fillOpacity: 0.45,
        strokeColor: '#66BB6A',
        strokeWeight: 1,
        strokeOpacity: 0.5,
        zIndex: 10,
      });
      STATE.map.add(circle);
      // 小绿树标记
      const m = new AMap.Marker({
        position: [p.lng, p.lat], title: p.name,
        icon: treeIcon,
        offset: new AMap.Pixel(-9, -20),
        zIndex: 100,
      });
      m.on('click', () => setOriginByCoord(p.lng, p.lat, p.name));
      STATE.map.add(m);
    });
    STATE.disposals.forEach(d => {
      const m = new AMap.Marker({
        position: [d.lng, d.lat], title: d.name,
        icon: dispIcon,
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
    document.getElementById('btnCVRP').onclick = solveCVRP;
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

  // ==================== CVRP 多车调度 (修复版) ====================
  const CVRP_COLORS = ['#D32F2F','#1976D2','#388E3C','#7B1FA2','#E64A19','#00796B'];
  const cvrpLayers = []; // { vehicleId, polylines: [], markers: [], visible: true }

  async function solveCVRP() {
    const btn = document.getElementById('btnCVRP');
    btn.textContent = '⏳ 调度计算中...'; btn.disabled = true;

    // 固废产量 (kg/天) — 基于面积估算
    const wasteMap = {
      '奥林匹克森林公园':8000,'奥林匹克公园':5500,'朝阳公园':5000,
      '温榆河公园':4000,'将府公园':2500,'太阳宫公园':2000,'红领巾公园':1800,
      '日坛公园':1500,'望京公园':1200,'团结湖公园':1000,'金铃狮园':900,
      '四得公园':800,'北小河公园':1500,'望和公园':1200,'朝来森林公园':1800,
      '东坝公园':1500,'常营公园':1300,'古塔公园':1100,'京城梨园':1000,
      '兴隆公园':1600,'北小河公园':1400,'望湖公园':900,'元大都城垣遗址公园':2000,
      '玉渊潭公园':3000,'陶然亭公园':2200,'紫竹院公园':1800,'海淀公园':2000,
      '东风公园':1200,'京城槐园':1000,'金盏森林公园':2000,'马家湾湿地公园':800,
    };
    const defaultWaste = 500;
    const parksWithWaste = STATE.parks.map(p => ({
      ...p, waste: wasteMap[p.name] || defaultWaste
    })).sort((a, b) => b.waste - a.waste);

    // 消纳点容量 (kg/天)
    const capMap = {
      '高安屯垃圾填埋场':60000,'小武基大型固废垃圾转运站':40000,
      '大屯垃圾转运站':30000,'朝环三清场酒仙桥有机生物处理站':30000,
      '朝阳生活垃圾焚烧中心':30000,
    };
    const defaultCap = 15000;
    const disposalsWithCap = STATE.disposals.map(d => ({
      ...d, capacity: capMap[d.name] || defaultCap
    }));

    // 车辆: 载重严格不可超
    const VEHICLES = [
      { id: 1, capacity: 8000 }, { id: 2, capacity: 8000 },
      { id: 3, capacity: 10000 }, { id: 4, capacity: 10000 },
      { id: 5, capacity: 5000 },
    ];

    // 初始化空路线
    const routes = VEHICLES.map(v => ({ vehicle: v, stops: [], load: 0, dispIdx: -1 }));
    const dispAvail = disposalsWithCap.map(d => d.capacity);

    // 贪婪分配: 大产量优先, 消纳点容量+车载容量双重约束
    let unassigned = [];
    parksWithWaste.forEach(park => {
      let bestVeh = -1, bestDisp = -1, bestCost = Infinity;

      for (let vi = 0; vi < routes.length; vi++) {
        const r = routes[vi];
        const vehRemain = r.vehicle.capacity - r.load;
        if (vehRemain < park.waste) continue; // 车载不下, 跳过

        for (let di = 0; di < disposalsWithCap.length; di++) {
          if (dispAvail[di] < park.waste) continue; // 消纳点满了, 跳过

          const d = disposalsWithCap[di];
          const dist = haversine(park.lng, park.lat, d.lng, d.lat);
          const speed = 35, timeMin = dist/speed*60;
          const co2 = AHP.co2Factor(speed)*dist, fuel = AHP.fuelCost(speed)*dist;
          const cost = 0.42*dist/50 + 0.23*timeMin/90 + 0.12*co2/10 + 0.23*fuel/60;

          if (cost < bestCost) { bestCost = cost; bestVeh = vi; bestDisp = di; }
        }
      }

      if (bestVeh >= 0 && bestDisp >= 0) {
        routes[bestVeh].stops.push(park);
        routes[bestVeh].load += park.waste;
        routes[bestVeh].dispIdx = bestDisp;
        dispAvail[bestDisp] -= park.waste;
      } else {
        unassigned.push(park);
      }
    });

    // 清除旧 CVRP 图层
    clearCVRPLayers();
    STATE.map.clearMap();
    addAllMarkers();

    // 只取有任务的车, 限制总路径数
    const usedRoutes = routes.filter(r => r.stops.length > 0);
    let totalDist = 0, totalLoad = 0;
    const summaryRows = [];
    const allVehiclePaths = []; // [ { vid, coords, color } ]

    btn.textContent = '⏳ 获取真实路径...';

    for (let ri = 0; ri < usedRoutes.length; ri++) {
      const route = usedRoutes[ri];
      const disp = disposalsWithCap[route.dispIdx];
      const color = CVRP_COLORS[ri % CVRP_COLORS.length];
      let prevPoint = null;
      const allCoords = [];

      // 只获取前6条公园间路径 (避免API调用过多)
      const maxRouteSegments = 6;
      const stopsToRoute = route.stops.slice(0, maxRouteSegments + 1);

      for (let si = 0; si < stopsToRoute.length; si++) {
        const stop = stopsToRoute[si];
        if (prevPoint) {
          btn.textContent = '⏳ 车' + route.vehicle.id + ' 路径' + si + '...';
          const coords = await fetchRouteCoords(prevPoint, stop);
          if (coords.length > 0) allCoords.push(...coords);
          else {
            // 直线兜底
            allCoords.push([prevPoint.lng, prevPoint.lat]);
            allCoords.push([stop.lng, stop.lat]);
          }
        }
        prevPoint = stop;
        totalLoad += stop.waste;
      }

      // 最后一段: 公园→消纳点
      if (prevPoint && disp) {
        btn.textContent = '⏳ 车' + route.vehicle.id + ' →消纳点...';
        const coords = await fetchRouteCoords(prevPoint, disp);
        if (coords.length > 0) allCoords.push(...coords);
        else { allCoords.push([prevPoint.lng, prevPoint.lat]); allCoords.push([disp.lng, disp.lat]); }
        totalDist += haversine(prevPoint.lng, prevPoint.lat, disp.lng, disp.lat);
      }

      allVehiclePaths.push({ vid: route.vehicle.id, coords: allCoords, color: color });

      // 绘制路线 (默认全部显示)
      const polyline = new AMap.Polyline({
        path: allCoords, strokeColor: color, strokeWeight: 5,
        strokeOpacity: 0.7, lineJoin: 'round', lineCap: 'round',
      });
      polyline.setMap(STATE.map);

      // 标记点
      const markers = [];
      route.stops.forEach((stop, si) => {
        if (si < maxRouteSegments + 1) {
          const m = new AMap.Marker({
            position: [stop.lng, stop.lat],
            label: { content: 'V'+route.vehicle.id, direction: 'top', offset: new AMap.Pixel(0,-5) },
            icon: new AMap.Icon({
              size: new AMap.Size(16,16),
              image: createCircleIcon(color),
              imageSize: new AMap.Size(16,16),
            }),
          });
          m.setMap(STATE.map);
          markers.push(m);
        }
      });
      if (disp) {
        const dm = new AMap.Marker({
          position: [disp.lng, disp.lat],
          label: { content: '消', direction: 'bottom' },
          icon: new AMap.Icon({
            size: new AMap.Size(20,20),
            image: createCircleIcon('#333'),
            imageSize: new AMap.Size(20,20),
          }),
        });
        dm.setMap(STATE.map);
        markers.push(dm);
      }

      cvrpLayers.push({ vehicleId: route.vehicle.id, polyline, markers, visible: true, color });

      summaryRows.push({
        vehicle: route.vehicle.id,
        color: color,
        stops: route.stops.length,
        load: route.load,
        capacity: route.vehicle.capacity,
        util: Math.min((route.load/route.vehicle.capacity*100), 100).toFixed(0),
        overCap: route.load > route.vehicle.capacity,
        disposal: disp ? disp.name : '?',
      });
    }

    // 面板: 每条路线可独立切换
    DOM.mapOverlay.classList.remove('hidden');
    DOM.routeCompare.innerHTML = `
      <div class="overlay-header"><span>🚛 CVRP多车调度</span></div>
      ${summaryRows.map((r, i) => `
        <div class="route-card cvrp-card" id="cvrpCard${i}" style="border-left:4px solid ${r.color}"
             onclick="window._toggleVehicle(${i})">
          <div class="route-title">
            <span class="cvrp-dot" style="background:${r.color}"></span>
            车${r.vehicle} | ${r.stops}公园 → ${r.disposal.slice(0,8)}...
          </div>
          <div class="route-meta">
            ${(r.load/1000).toFixed(1)}/${(r.capacity/1000).toFixed(0)}吨 (${r.util}%)
            ${r.overCap ? ' <b style=color:red>超载!</b>' : ''}
          </div>
        </div>`).join('')}
      <div class="route-card" style="background:#F5F5F5">
        <b>总计: ${usedRoutes.length}车 | ${(totalLoad/1000).toFixed(0)}吨</b>
        ${unassigned.length > 0 ? ' | <span style=color:red>'+unassigned.length+'公园未分配</span>' : ''}
      </div>
    `;

    // 存储供toggle用
    window._cvrpData = { allVehiclePaths, summaryRows, usedRoutes };

    DOM.resultBar.classList.remove('hidden');
    ['resDistance','resTime','resCO2','resFuel','resScore','resCongestion'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('resDistance').textContent = '~' + (totalDist|0) + ' km';
    document.getElementById('resScore').textContent = usedRoutes.length + ' 车';
    if (unassigned.length > 0) document.getElementById('resCongestion').textContent = unassigned.length + '未分配';

    btn.textContent = '🚛 多车调度 (CVRP)';
    btn.disabled = false;
  }

  window._toggleVehicle = function(idx) {
    const layer = cvrpLayers[idx];
    if (!layer) return;
    layer.visible = !layer.visible;
    if (layer.visible) {
      layer.polyline.setMap(STATE.map);
      layer.markers.forEach(m => m.setMap(STATE.map));
    } else {
      layer.polyline.setMap(null);
      layer.markers.forEach(m => m.setMap(null));
    }
    const card = document.getElementById('cvrpCard'+idx);
    if (card) card.style.opacity = layer.visible ? '1' : '0.35';
  };

  function clearCVRPLayers() {
    cvrpLayers.forEach(l => {
      if (l.polyline) l.polyline.setMap(null);
      l.markers.forEach(m => m.setMap(null));
    });
    cvrpLayers.length = 0;
  }

  let _cvrpClearTimer = null;
  function fetchRouteCoords(from, to) {
    return new Promise((resolve) => {
      const cb = '_rv_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      if (_cvrpClearTimer) clearTimeout(_cvrpClearTimer);
      window[cb] = function(data) {
        delete window[cb];
        const coords = [];
        try {
          if (data && data.route && data.route.paths && data.route.paths[0]) {
            data.route.paths[0].steps.forEach(s => {
              (s.polyline || '').split(';').forEach(p => {
                const [lng, lat] = p.split(',').map(Number);
                if (!isNaN(lng)) coords.push([lng, lat]);
              });
            });
          }
        } catch(e) {}
        resolve(coords.length > 0 ? coords : []);
      };
      const s = document.createElement('script');
      s.src = 'https://restapi.amap.com/v3/direction/driving?key=eb6fd67c6315d8e306616259ee6d8e3b&origin='
        + from.lng + ',' + from.lat + '&destination=' + to.lng + ',' + to.lat
        + '&extensions=all&output=JSON&callback=' + cb;
      s.onerror = () => { delete window[cb]; resolve([]); };
      document.head.appendChild(s);
      _cvrpClearTimer = setTimeout(() => { if (s.parentNode) s.remove(); delete window[cb]; resolve([]); }, 10000);
    });
  }

  function createCircleIcon(color) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const ctx = c.getContext('2d'); ctx.beginPath(); ctx.arc(8, 8, 7, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    return c.toDataURL();
  }

  function haversine(lng1, lat1, lng2, lat2) {
    const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ==================== 路况切换 ====================
  window._toggleTraffic = function() {
    STATE.trafficOn = !STATE.trafficOn;
    const btn = document.getElementById('trafficToggle');
    if (STATE.trafficOn) {
      STATE.trafficLayer.setMap(STATE.map);
      btn.classList.add('active');
      btn.innerHTML = '<span>🚦 实时路况 ●</span>';
    } else {
      STATE.trafficLayer.setMap(null);
      btn.classList.remove('active');
      btn.innerHTML = '<span>🚦 实时路况</span>';
    }
  };

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
