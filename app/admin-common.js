// 관리자 화면들이 같이 쓰는 이름표와 작은 도우미
import { h } from './lib.js';

export const REQ_STATUS = { pending: '요청됨', making: '만드는 중', ready: '완료', failed: '취소' };
export const KIND = { story: '동화', song: '노래' };
export const PLAN = {
  beta_tester: '사전 체험단', trial_once: '1회 체험권', trial_month: '1개월 체험권', monthly: '월간 구독',
  story_once: '동화 제작', song_once: '노래 제작', story_song_bundle: '동화 + 노래 제작',
};

export const dt = (s) => (s
  ? new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '–');

export const statusBadge = (s) => h('span', { class: 'badge', dataset: { status: s } }, REQ_STATUS[s] ?? s);

export const historyDate = (value) => new Date(value).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function historySummary(event) {
  const { added_count: added, removed_count: removed } = event;
  const change = added && removed ? `파일 변경 (추가 ${added}개, 제외 ${removed}개)`
    : added ? `파일 ${added}개 업로드` : removed ? `파일 ${removed}개 제외` : '작품 저장';
  return event.published ? `${change} · 사용자에게 공개` : change;
}

export const emptyRow = (cols, text) =>
  h('tr', {}, h('td', { colspan: cols, class: 'muted', style: 'text-align:center;padding:24px' }, text));
