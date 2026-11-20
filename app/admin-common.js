// 관리자 화면들이 같이 쓰는 이름표와 작은 도우미
import { h } from './lib.js';

export const REQ_STATUS = { pending: '요청됨', making: '만드는 중', ready: '완료', failed: '취소' };
export const KIND = { story: '동화', song: '노래' };
export const PLAN = { beta_tester: '사전 체험단', trial_once: '1회 체험권', trial_month: '1개월 체험권', monthly: '월간 구독' };

export const dt = (s) => (s
  ? new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '–');

export const statusBadge = (s) => h('span', { class: 'badge', dataset: { status: s } }, REQ_STATUS[s] ?? s);

export const emptyRow = (cols, text) =>
  h('tr', {}, h('td', { colspan: cols, class: 'muted', style: 'text-align:center;padding:24px' }, text));
