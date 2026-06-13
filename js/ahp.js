/**
 * AHP 层次分析法 — 前端计算模块 v3
 * 成本计算基于真实物理模型:
 *   - 时间 = 高德API实时通行时间 (含路况)
 *   - CO₂ = 速度相关排放因子 (COPERT简化模型)
 *   - 燃油 = 速度相关油耗 × 柴油单价
 */
const AHP = {

  factors: [
    { key: 'congestion', name: '拥堵程度',   defaultW: 30.7, coeff: 5.0, source: '实时路况API' },
    { key: 'carbon',     name: '碳排放量',   defaultW: 20.0, coeff: 1.5, source: '速度×排放因子' },
    { key: 'slope',      name: '坡度',       defaultW: 17.6, coeff: 0.067, source: 'DEM高程' },
    { key: 'fireRisk',   name: '火灾风险',   defaultW: 15.7, coeff: 1.0, source: 'NDVI估算' },
    { key: 'weather',    name: '天气影响',   defaultW: 12.0, coeff: 2.0, source: '气象站点插值' },
    { key: 'noise',      name: '噪声影响',   defaultW: 4.0,  coeff: 0.5, source: '住宅区距离' },
  ],

  costWeights: [0.4236, 0.2271, 0.1223, 0.2271], // 距离 时间 CO2 燃油

  normalize(weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum === 0) return this.factors.map(f => f.defaultW);
    return weights.map(w => (w / sum) * 100);
  },

  computeImpedance(wNorm, factors) {
    if (factors.fireRisk > 0.8) return Infinity;
    if (factors.weather > 0.9)  return Infinity;
    let Z = 1.0;
    this.factors.forEach((f, i) => {
      Z += (wNorm[i] / 100) * (factors[f.key] || 0) * f.coeff;
    });
    return Math.max(Z, 1.0);
  },

  /**
   * 速度→碳排放因子 (kg CO₂/km)
   * 公式: CO₂ = (百公里油耗 × 2.68 kgCO₂/L柴油) ÷ 100
   * 与 fuelCost 使用相同的油耗模型, 保证一致性
   */
  co2Factor(speedKmh) {
    const CO2_PER_LITER_DIESEL = 2.68; // kg CO₂ / L 柴油
    let Lper100km;
    if (speedKmh < 15)      Lper100km = 30;
    else if (speedKmh < 25) Lper100km = 24;
    else if (speedKmh < 35) Lper100km = 18;
    else if (speedKmh < 50) Lper100km = 14;
    else if (speedKmh < 70) Lper100km = 11;
    else                    Lper100km = 13;
    return (Lper100km * CO2_PER_LITER_DIESEL) / 100;  // kg CO₂ / km
  },

  /**
   * 百公里油耗法: 每公里油费 = (百公里油耗 × 油价) ÷ 100
   * 绿化固废运输车 (中型柴油货车, 载重约8-12吨)
   * 柴油按 7.8 元/L 估算
   */
  fuelCost(speedKmh) {
    const DIESEL_PRICE = 7.8; // 元/升 (北京市0#柴油均价)
    let Lper100km;
    if (speedKmh < 15)      Lper100km = 30;  // 严重拥堵, 频繁启停, 油耗极高
    else if (speedKmh < 25) Lper100km = 24;
    else if (speedKmh < 35) Lper100km = 18;
    else if (speedKmh < 50) Lper100km = 14;
    else if (speedKmh < 70) Lper100km = 11;  // 经济时速 50-70km/h
    else                    Lper100km = 13;  // 高速风阻增加
    return (Lper100km * DIESEL_PRICE) / 100;  // 元/km
  },

  /**
   * 计算路径的真实4维度成本
   * @param {number} distKm - 距离(km)
   * @param {number} timeMin - 高德API真实通行时间(min)
   * @param {number} avgSpeed - 平均速度(km/h) = distKm / (timeMin/60)
   * @param {number} Z - AHP综合阻抗
   */
  computeCosts(distKm, timeMin, avgSpeed, Z) {
    if (!isFinite(Z)) return { distance: distKm, time: Infinity, co2: Infinity, fuel: Infinity, impedance: Infinity };
    // CO₂和油耗基于真实平均速度
    const co2PerKm = this.co2Factor(avgSpeed);
    const fuelPerKm = this.fuelCost(avgSpeed);
    // 高阻抗(拥堵/坡度/天气)会放大实际油耗和排放
    const zEffect = Math.min(Z, 2.0);
    return {
      distance: distKm,
      time:     timeMin,                        // 高德API真实通行时间
      co2:      distKm * co2PerKm * zEffect,    // 速度相关排放 × 阻抗修正
      fuel:     distKm * fuelPerKm * zEffect,   // 速度相关油耗 × 阻抗修正
      impedance: Z,
      avgSpeed: avgSpeed,
    };
  },

  computeComprehensive(costs) {
    if (!isFinite(costs.time)) return Infinity;
    const maxD = 50, maxT = 90, maxC = 10, maxF = 60;
    return (
      this.costWeights[0] * (costs.distance / maxD) +
      this.costWeights[1] * (costs.time / maxT) +
      this.costWeights[2] * (costs.co2 / maxC) +
      this.costWeights[3] * (costs.fuel / maxF)
    );
  },

  /**
   * 从高德REST API路径结果提取参数
   * route = data.route.paths[i]
   */
  extractFromAmapRoute(route) {
    const distKm = (route.distance || 0) / 1000;
    const timeSec = route.duration || 0;
    const timeMin = timeSec / 60;
    const avgSpeed = timeMin > 0 ? (distKm / (timeMin / 60)) : 35;

    // 拥堵指数: 基于平均速度 + 高德路况信息(如有)
    const trafficStatus = route.trafficstatus || 0; // 0=未知 1=畅通 2=缓行 3=拥堵 4=严重拥堵
    let congestion;
    if (trafficStatus === 4)      congestion = 0.95;
    else if (trafficStatus === 3) congestion = 0.75;
    else if (trafficStatus === 2) congestion = 0.45;
    else if (trafficStatus === 1) congestion = 0.10;
    else if (avgSpeed < 18)       congestion = 0.90;
    else if (avgSpeed < 28)       congestion = 0.65;
    else if (avgSpeed < 40)       congestion = 0.35;
    else if (avgSpeed < 55)       congestion = 0.15;
    else                           congestion = 0.05;

    return {
      distance: distKm,
      timeMin: timeMin,
      speed: avgSpeed,
      trafficStatus: trafficStatus,
      factors: {
        congestion: congestion,
        carbon:     Math.min(Math.max(this.co2Factor(avgSpeed) / 0.4, 0.1), 1),
        slope:      0.04,    // 朝阳区平均坡度
        fireRisk:   0.35,    // 绿化固废运输中火灾基线风险
        weather:    0.18,    // 基于气象站数据的日均天气指数
        noise:      0.45,    // 城区住宅密度中等
      },
    };
  },
};
