/* ============================================================
   취득세 계산 API — Vercel Serverless Function
   POST /api/calculate
   모든 세율·공식·부가세 규칙은 이 파일(서버)에만 존재합니다.
   방문자는 이 코드를 볼 수 없습니다.
   ============================================================ */

const fmtFull = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

/* ─── 주택 기본세율 (% 단위: 1, 2.33, 3 등) ─── */
function getHouseBaseRate(price) {
  if (price <= 600000000) return 1;
  if (price <= 900000000) {
    const raw = (price / 100000000) * 2 / 3 - 3; /* % 단위 결과 */
    return Math.round(raw * 10000) / 10000;      /* 소수점 5째자리 반올림 */
  }
  return 3;
}

/* ─── 다주택 중과세율 판정 (기본세율이면 0 반환) ─── */
function getHeavyRate(houseCount, region) {
  const adj = region === 'adj';
  if (houseCount <= 1) return 0;
  if (houseCount === 2) return adj ? 8 : 0;
  if (houseCount === 3) return adj ? 12 : 8;
  return 12; /* 4주택 이상 */
}

/* ─── 부가세 (지방교육세 + 농어촌특별세) ─── */
function calcSurtax({ base, rate, isHeavy, heavyRate, area85, tab, subType }) {
  let edu = 0, rural = 0, eduLabel = '', ruralLabel = '';

  if (tab === 'sale' && subType === 'house') {
    if (!isHeavy) {
      edu = Math.floor((base * rate) / 100 * 0.1);
      eduLabel = `취득가액 × ${rate}% × 10%`;
      if (area85) { rural = 0; ruralLabel = '비과세 (85㎡ 이하)'; }
      else { rural = Math.floor(base * 0.002); ruralLabel = '취득가액 × 0.2%'; }
    } else {
      edu = Math.floor(base * 0.004);
      eduLabel = '취득가액 × 0.4%';
      if (area85) { rural = 0; ruralLabel = '비과세 (85㎡ 이하)'; }
      else if (heavyRate === 8) { rural = Math.floor(base * 0.006); ruralLabel = '취득가액 × 0.6% (8% 중과)'; }
      else { rural = Math.floor(base * 0.010); ruralLabel = '취득가액 × 1.0% (12% 중과)'; }
    }
  } else if (tab === 'sale') {
    /* 주택 외 */
    edu = Math.floor(base * 0.004); eduLabel = '취득가액 × 0.4%';
    rural = Math.floor(base * 0.002); ruralLabel = '취득가액 × 0.2%';
  } else if (tab === 'gift') {
    if (subType === 'house') {
      if (!isHeavy) {
        edu = Math.floor(base * 0.003); eduLabel = '취득가액 × 0.3%';
        if (area85) { rural = 0; ruralLabel = '비과세 (85㎡ 이하)'; }
        else { rural = Math.floor(base * 0.002); ruralLabel = '취득가액 × 0.2%'; }
      } else {
        edu = Math.floor(base * 0.004); eduLabel = '취득가액 × 0.4%';
        if (area85) { rural = 0; ruralLabel = '비과세 (85㎡ 이하)'; }
        else { rural = Math.floor(base * 0.010); ruralLabel = '취득가액 × 1.0% (12% 중과)'; }
      }
    } else {
      edu = Math.floor(base * 0.003); eduLabel = '취득가액 × 0.3%';
      rural = Math.floor(base * 0.002); ruralLabel = '취득가액 × 0.2%';
    }
  } else if (tab === 'inherit') {
    edu = Math.floor(base * 0.0016); eduLabel = '취득가액 × 0.16%';
    if (subType === 'special') {
      rural = 0; ruralLabel = '비과세 (특례세율 적용 시 면적 무관 비과세)';
    } else if (subType === 'other') {
      rural = Math.floor(base * 0.002); ruralLabel = '취득가액 × 0.2%';
    } else {
      if (area85) { rural = 0; ruralLabel = '비과세 (85㎡ 이하)'; }
      else { rural = Math.floor(base * 0.002); ruralLabel = '취득가액 × 0.2%'; }
    }
  } else if (tab === 'newbuild') {
    edu = Math.floor(base * 0.0016); eduLabel = '취득가액 × 0.16%';
    if (subType === 'house') {
      if (area85) { rural = 0; ruralLabel = '비과세 (85㎡ 이하)'; }
      else { rural = Math.floor(base * 0.002); ruralLabel = '취득가액 × 0.2%'; }
    } else {
      rural = Math.floor(base * 0.002); ruralLabel = '취득가액 × 0.2%';
    }
  }

  return { edu, rural, eduLabel, ruralLabel };
}

/* ─── 탭별 계산 ─── */
function calcSale(b) {
  const price = num(b.price), stdVal = num(b.std);
  const base = b.acq === 'before' ? Math.max(price, stdVal || price) : price;

  let rate, rateLabel, isHeavy = false;
  if (b.type === 'other') {
    rate = 4; rateLabel = '4%';
  } else {
    const heavy = getHeavyRate(parseInt(b.houseCount, 10) || 1, b.region === 'non' ? 'non' : 'adj');
    if (heavy > 0) { rate = heavy; rateLabel = heavy + '%'; isHeavy = true; }
    else { rate = getHouseBaseRate(base); rateLabel = parseFloat(rate.toFixed(4)) + '%'; }
  }

  const tax = Math.floor((base * rate) / 100);
  const area85 = b.type === 'house' ? !!b.area85 : false;
  const st = calcSurtax({ base, rate, isHeavy, heavyRate: rate, area85, tab: 'sale', subType: b.type });

  const isProg = base > 600000000 && base <= 900000000 && !isHeavy && b.type === 'house';
  let baseReason;
  if (b.acq === 'before') baseReason = 'Max(취득가액, 시가표준액) 적용';
  else if (isProg) baseReason = `누진 공식 적용: (${(base / 100000000).toFixed(4)} × 2/3 − 3) × 1/100`;
  else baseReason = isHeavy ? '중과세율 적용' : '취득가액 기준';

  let saleBracket = null;
  if (b.type === 'house' && !isHeavy) saleBracket = base <= 600000000 ? 0 : base <= 900000000 ? 1 : 2;

  const steps = [];
  steps.push({ label: '취득가액', value: fmtFull(price) });
  if (b.acq === 'before' && stdVal > 0) {
    steps.push({ label: '시가표준액', value: fmtFull(stdVal) });
    steps.push({ label: '= 과세표준 (Max 적용)', value: fmtFull(base) });
  } else {
    steps.push({ label: '= 과세표준', value: fmtFull(base) });
  }
  if (isProg) {
    steps.push({ label: `× 취득세율 — 누진 공식 (${(base / 100000000).toFixed(4)} × 2/3 − 3) × 1/100 = ${rateLabel}`, value: '' });
  } else {
    steps.push({ label: `× 취득세율 (${rateLabel})`, value: '' });
  }

  return finish({ base, tax, rate, rateLabel, st, steps, baseReason, saleBracket,
    deadline: '잔금일로부터 60일 이내 신고·납부' });
}

function calcGift(b) {
  const price = num(b.price);
  const base = price;
  const isHeavy = b.type === 'house' && b.heavy === true;
  const rate = isHeavy ? 12 : 3.5;
  const rateLabel = rate + '%';
  const tax = Math.floor((base * rate) / 100);
  const area85 = b.type === 'house' ? (b.area85 !== false) : true;
  const st = calcSurtax({ base, rate, isHeavy, heavyRate: rate, area85, tab: 'gift', subType: b.type });

  const baseKind = b.acq === 'after'
    ? (b.stdtype === 'siga' ? '시가인정액' : '시가표준액')
    : '시가표준액';

  const steps = [
    { label: `과세표준 (${baseKind})`, value: fmtFull(base) },
    { label: `× 취득세율 (${rateLabel})`, value: '' },
  ];

  return finish({ base, tax, rate, rateLabel, st, steps,
    baseReason: baseKind + ' 과세표준 적용',
    deadline: '계약일 속하는 달 말일로부터 3개월 이내 신고·납부' });
}

function calcInherit(b) {
  const price = num(b.price);
  const base = price;
  const rate = b.type === 'special' ? 0.8 : 2.8;
  const rateLabel = rate + '%';
  const tax = Math.floor((base * rate) / 100);
  const st = calcSurtax({ base, rate, isHeavy: false, heavyRate: 0, area85: !!b.area85, tab: 'inherit', subType: b.type });

  const steps = [
    { label: '과세표준 (시가표준액)', value: fmtFull(base) },
    { label: `× 취득세율 (${rateLabel})`, value: '' },
  ];

  return finish({ base, tax, rate, rateLabel, st, steps,
    baseReason: '시가표준액 과세표준 적용',
    deadline: '상속개시일 속하는 달 말일로부터 6개월 이내 신고·납부' });
}

function calcNewbuild(b) {
  const price = num(b.price), stdVal = num(b.std);
  let base, baseReason;
  if (b.acq === 'before') {
    base = Math.max(price, stdVal || price);
    baseReason = 'Max(취득가액, 시가표준액) 적용';
  } else {
    base = price;
    baseReason = b.known === 'no' ? '시가표준액 기준 (신축비용 불명)' : '취득가액(신축비용) 기준';
  }
  const rate = 2.8, rateLabel = '2.80%';
  const tax = Math.floor(base * 0.028);
  const area85 = b.type === 'house' ? !!b.area85 : false;
  const st = calcSurtax({ base, rate, isHeavy: false, heavyRate: 0, area85, tab: 'newbuild', subType: b.type });

  const priceLabel = (b.acq === 'after' && b.known === 'no') ? '시가표준액' : '취득가액 (신축비용)';
  const steps = [];
  steps.push({ label: priceLabel, value: fmtFull(price) });
  if (b.acq === 'before') steps.push({ label: '시가표준액', value: fmtFull(stdVal || price) });
  steps.push({ label: '= 과세표준', value: fmtFull(base) });
  steps.push({ label: `× 취득세율 (${rateLabel})`, value: '' });

  return finish({ base, tax, rate, rateLabel, st, steps, baseReason,
    deadline: '사용승인일·임시사용승인일·사실상사용일로부터 60일 이내 신고·납부' });
}

/* ─── 공통 마무리: 부가세 스텝, 합계, 응답 조립 ─── */
function finish({ base, tax, rateLabel, st, steps, baseReason, saleBracket = null, deadline }) {
  steps.push({ label: '= 취득세 본세', value: fmtFull(tax) });
  steps.push({ label: `+ 지방교육세 (${st.eduLabel})`, value: fmtFull(st.edu) });
  if (st.rural > 0) steps.push({ label: `+ 농어촌특별세 (${st.ruralLabel})`, value: fmtFull(st.rural) });
  else steps.push({ label: '+ 농어촌특별세', value: st.ruralLabel });

  const total = tax + st.edu + st.rural;
  steps.push({ label: '총 납부세액', value: fmtFull(total), total: true });

  return {
    base,
    rateLabel,
    baseReason,
    saleBracket,
    baseText: fmtFull(base),
    taxText: fmtFull(tax),
    eduText: fmtFull(st.edu),
    ruralText: st.rural > 0 ? fmtFull(st.rural) : '비과세',
    totalText: fmtFull(total),
    deadline,
    notice: deadline + ' · 이 계산기는 참고용이며 실제 고지세액과 다를 수 있습니다.',
    steps,
  };
}

function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ─── HTTP 핸들러 ─── */
module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const b = req.body || {};

  /* 입력 검증 */
  if (!['sale', 'gift', 'inherit', 'newbuild'].includes(b.tab)) {
    res.status(400).json({ error: '잘못된 요청입니다.' });
    return;
  }
  if (!num(b.price)) {
    res.status(400).json({ error: '금액을 입력하세요.' });
    return;
  }
  if (num(b.price) > 1e15) {
    res.status(400).json({ error: '금액이 너무 큽니다.' });
    return;
  }

  try {
    let result;
    if (b.tab === 'sale') result = calcSale(b);
    else if (b.tab === 'gift') result = calcGift(b);
    else if (b.tab === 'inherit') result = calcInherit(b);
    else result = calcNewbuild(b);

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: '계산 중 오류가 발생했습니다.' });
  }
};
