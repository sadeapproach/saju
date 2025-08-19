// /api/calc.js  — CommonJS + Node runtime (Vercel default)
// 표준 규칙: 현지 자정 일경계 / 절기(중기) 월경계 / 일간기준 시주

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { Solar } = require('lunar-javascript');

dayjs.extend(utc);
dayjs.extend(timezone);

const STEM_TO_ELEM = {
  '甲':'wood','乙':'wood','丙':'fire','丁':'fire','戊':'earth',
  '己':'earth','庚':'metal','辛':'metal','壬':'water','癸':'water'
};
const BRANCH_TO_ELEM = {
  '子':'water','丑':'earth','寅':'wood','卯':'wood','辰':'earth','巳':'fire',
  '午':'fire','未':'earth','申':'metal','酉':'metal','戌':'earth','亥':'water'
};
const TEN_GODS_KR = {
  '比肩':'비견','劫财':'겁재','食神':'식신','伤官':'상관','偏财':'편재','正财':'정재',
  '七杀':'편관','正官':'정관','偏印':'편인','正印':'정인'
};
const mapTenGod = (cn)=> TEN_GODS_KR[cn] ? `${TEN_GODS_KR[cn]} (${cn})` : cn;

function fail(res, code, msg){
  res.status(code).json({ ok:false, error:msg });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

    const { birthDateISO, birthTime, tzId } = req.body || {};
    if (!birthDateISO || !birthTime || !tzId)
      return fail(res, 400, 'Missing birthDateISO/birthTime/tzId');

    // 1) 현지 자정(00:00) 경계 보장 — 일주가 23시에 바뀌지 않도록
    const local = dayjs.tz(`${birthDateISO}T${birthTime}:00`, tzId);
    if (!local.isValid()) return fail(res, 400, 'Invalid datetime or tzId');

    // 2) lunar-javascript로 표준 8자 계산 (월주=절기 / 시주=일간 기준)
    const s = Solar.fromYmdHms(
      local.year(), local.month() + 1, local.date(),
      local.hour(), local.minute(), local.second()
    );
    const lunar = s.getLunar();
    const eight = lunar.getEightChar();

    const yG = eight.getYearGan().toString();
    const yZ = eight.getYearZhi().toString();
    const mG = eight.getMonthGan().toString();
    const mZ = eight.getMonthZhi().toString();
    const dG = eight.getDayGan().toString();
    const dZ = eight.getDayZhi().toString();
    const hG = eight.getTimeGan().toString();
    const hZ = eight.getTimeZhi().toString();

    const pillars = {
      year:  { stem: yG, branch: yZ },
      month: { stem: mG, branch: mZ },
      day:   { stem: dG, branch: dZ },
      hour:  { stem: hG, branch: hZ }
    };

    // 3) 십신(일간 기준)
    const tenGods = {
      year:  mapTenGod(eight.getYearShiShen().toString()),
      month: mapTenGod(eight.getMonthShiShen().toString()),
      day:   'Self / Day Master',
      hour:  mapTenGod(eight.getTimeShiShen().toString()),
      byPillar: {}
    };
    tenGods.byPillar = {
      year: tenGods.year, month: tenGods.month, day: tenGods.day, hour: tenGods.hour
    };

    // 4) 5행 간단 합산(간/지 매칭)
    const elements = { wood:0, fire:0, earth:0, metal:0, water:0 };
    Object.values(pillars).forEach(p=>{
      elements[STEM_TO_ELEM[p.stem]]  += 1;
      elements[BRANCH_TO_ELEM[p.branch]] += 1;
    });

    // 5) 대운 — 라이브러리 버전차 보호(에러 나면 빈 배열)
    let bigLuck = [];
    try {
      // 일부 버전은 성별 인자를 요구(1/0). 일단 1(남)로 시도하고 실패 시 skip.
      const yun = lunar.getYun ? lunar.getYun(1) : null;
      if (yun && yun.getDaYun) {
        const arr = yun.getDaYun();
        bigLuck = arr.slice(0, 7).map((dy)=>({
          startAge: dy.getStartAge && dy.getStartAge(),
          stem: (dy.getGan()?.toString?.()) || '',
          branch: (dy.getZhi()?.toString?.()) || '',
          tenGod: mapTenGod(dy.getShiShen?.().toString?.() || '')
        }));
      }
    } catch { /* no-op, keep [] */ }

    return res.status(200).json({
      ok: true,
      data: {
        pillars,
        elements,
        tenGods,
        luck: { bigLuck } // 없으면 프론트에서 그냥 비어 있는 상태로 표시
      }
    });
  } catch (e) {
    return fail(res, 500, String(e && e.message || e));
  }
};
