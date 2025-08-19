// /lib/sajuEngine.js
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(tz);

const { Solar } = require('lunar-javascript');

// 안전 호출 유틸 (라이브러리 버전에 따라 메소드명이 조금씩 다름)
function call(lunar, names) {
  for (const n of names) {
    if (typeof lunar[n] === 'function') return lunar[n]();
  }
  return null;
}
function splitGZ(gz) {
  if (!gz || typeof gz !== 'string') return { stem: '', branch: '' };
  // '癸巳' 같이 2글자 기준
  const chars = Array.from(gz);
  return { stem: chars[0] || '', branch: chars[1] || '' };
}

function calcPillars({ birthDateISO, birthTime = '00:00', tzId }) {
  // tz 기준의 현지 시각으로 Solar 생성
  const dt = dayjs.tz(`${birthDateISO} ${birthTime}`, tzId);
  const y = dt.year();
  const m = dt.month() + 1;
  const d = dt.date();
  const H = dt.hour();
  const M = dt.minute();

  const solar = Solar.fromYmdHms(y, m, d, H, M, 0);
  const lunar = solar.getLunar();

  // 라이브러리 메소드 이름 호환 처리
  const yGZ = call(lunar, ['getYearInGanZhiExact', 'getYearInGanZhi']);
  const mGZ = call(lunar, ['getMonthInGanZhiExact', 'getMonthInGanZhi']);
  const dGZ = call(lunar, ['getDayInGanZhiExact', 'getDayInGanZhi']);
  const hGZ = call(lunar, ['getTimeInGanZhiExact', 'getTimeInGanZhi']);

  const year = splitGZ(yGZ);
  const month = splitGZ(mGZ);
  const day = splitGZ(dGZ);
  const hour = splitGZ(hGZ);

  // 대운(있으면), 없으면 빈 배열
  let bigLuck = [];
  try {
    const list = lunar.getDaYun ? lunar.getDaYun(1) : [];
    bigLuck = (list || []).map((dy) => {
      // 버전에 따라 API 다름: 안전 접근
      const startAge = dy.getStartAge ? dy.getStartAge() : dy.startAge || 0;
      const gz = dy.getGanZhi ? dy.getGanZhi() : (dy.ganZhi || '');
      const { stem, branch } = splitGZ(gz);
      return { startAge, stem, branch };
    });
  } catch (_) {
    bigLuck = [];
  }

  return {
    tzId,
    pillars: { year, month, day, hour },
    luck: { bigLuck }
  };
}

module.exports = { calcPillars };
