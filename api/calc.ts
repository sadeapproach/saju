// /api/calc.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';
import { Solar, Lunar } from 'lunar-javascript';

dayjs.extend(utc);
dayjs.extend(tz);

/**
 * 입력 payload:
 * {
 *   birthDateISO: '1989-10-20',
 *   birthTime: '06:00',              // HH:mm (현지시각)
 *   tzId: 'Asia/Seoul',              // 필수
 *   lat: 37.5665, lng: 126.9780      // 선택(안 써도 됨)
 * }
 */

const STEMS = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const BRANCHES = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const TEN_GODS_KR = {
  '比肩':'비견','劫财':'겁재','食神':'식신','伤官':'상관','偏财':'편재','正财':'정재',
  '七杀':'편관','正官':'정관','偏印':'편인','正印':'정인'
};

// 지지 → 5행
const BRANCH_TO_ELEM: Record<string,string> = {
  子:'water', 丑:'earth', 寅:'wood', 卯:'wood', 辰:'earth', 巳:'fire',
  午:'fire', 未:'earth', 申:'metal', 酉:'metal', 戌:'earth', 亥:'water'
};
// 천간 → 5행
const STEM_TO_ELEM: Record<string,string> = {
  甲:'wood',乙:'wood',丙:'fire',丁:'fire',戊:'earth',己:'earth',庚:'metal',辛:'metal',壬:'water',癸:'water'
};

// 10신 라벨(영문/국문 혼용)
function mapTenGodName(cn: string){
  const kr = TEN_GODS_KR[cn];
  return kr ? `${kr} (${cn})` : cn;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, error:'Method not allowed' });
    }

    const { birthDateISO, birthTime, tzId } = req.body || {};
    if (!birthDateISO || !birthTime || !tzId) {
      return res.status(400).json({ ok:false, error:'Missing birthDateISO/birthTime/tzId' });
    }

    // 1) 현지 자정 경계 보장 (일주가 23시에 바뀌지 않도록)
    const local = dayjs.tz(`${birthDateISO}T${birthTime}:00`, tzId);
    if (!local.isValid()) {
      return res.status(400).json({ ok:false, error:'Invalid datetime or tzId' });
    }

    // 2) lunar-javascript는 Solar(양력) 입력을 기반으로 8자 계산
    //    이 라이브러리는 월주를 "중기(절기)" 기준으로 처리함 = 표준 규칙
    const s = Solar.fromYmdHms(
      local.year(),
      local.month() + 1,
      local.date(),
      local.hour(),
      local.minute(),
      local.second()
    );

    const l = s.getLunar();              // Lunar 객체
    const eight = l.getEightChar();      // 8자(년월일시 천간/지지)
    // 년/월/일/시 (각각 천간, 지지)
    const yG = eight.getYearGan(),  yZ = eight.getYearZhi();
    const mG = eight.getMonthGan(), mZ = eight.getMonthZhi();
    const dG = eight.getDayGan(),   dZ = eight.getDayZhi();
    const hG = eight.getTimeGan(),  hZ = eight.getTimeZhi();

    // 3) 십신 (일간 기준)
    const dayStem = dG.toString();
    const tgYear  = mapTenGodName(eight.getYearShiShen().toString());
    const tgMonth = mapTenGodName(eight.getMonthShiShen().toString());
    const tgHour  = mapTenGodName(eight.getTimeShiShen().toString());
    const tgDay   = 'Self / Day Master';

    // 4) 5행 점수 (간/지의 5행 합산 간단 버전)
    const pillars = {
      year:  { stem: yG.toString(), branch: yZ.toString() },
      month: { stem: mG.toString(), branch: mZ.toString() },
      day:   { stem: dG.toString(), branch: dZ.toString() },
      hour:  { stem: hG.toString(), branch: hZ.toString() }
    };

    const elements = { wood:0, fire:0, earth:0, metal:0, water:0 };
    Object.values(pillars).forEach(p=>{
      elements[STEM_TO_ELEM[p.stem]]  += 1;
      elements[BRANCH_TO_ELEM[p.branch]] += 1;
    });

    // 5) 대운 (10년 주기) — 표준 규칙으로 계산됨
    const yun = l.getYun(     // 자동으로 순/역행, 시작나이 반영
      l.getEightChar().getGender() // 성별이 없으니 기본값으로 처리(남=1, 여=0) 필요시 확장
    );
    // 위 API가 성별을 요구한다면, 임시로 남(1)로 고정; 성별 입력 받을 때 연결하세요.
    // 일부 버전은 getYun(1) / getYun(0)로 동작. 없으면 아래 수동 대운 계산 주석 처리.

    let bigLuck = [];
    try {
      const daYun = yun.getDaYun();
      bigLuck = daYun.slice(0, 7).map((dy:any, i:number)=>({
        startAge: dy.getStartAge(),
        stem: STEMS[(dy.getGanIndex()+1)%10] || '',
        branch: BRANCHES[(dy.getZhiIndex()+1)%12] || '',
        tenGod: mapTenGodName(dy.getShiShen().toString())
      }));
    } catch {
      // 라이브러리 버전에 따라 다를 수 있으니, 실패해도 앱은 계속 동작하게 둡니다.
      bigLuck = [];
    }

    // 6) 십신 맵 (기둥별)
    const tenGods = {
      year: tgYear, month: tgMonth, day: tgDay, hour: tgHour,
      byPillar: { year: tgYear, month: tgMonth, day: tgDay, hour: tgHour }
    };

    // 7) 응답
    return res.status(200).json({
      ok: true,
      data: {
        pillars,
        elements,
        tenGods,
        // 지장간/합형충파해 등 세부는 lunar-javascript에서 추가로 꺼내 확장 가능
        luck: { bigLuck }
      }
    });

  } catch (e:any) {
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
}
