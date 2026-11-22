// Short tips shown while a classroom loads. They teach how the classroom works, so the wait is not wasted.
export const CLASSROOM_TIPS = [
  '先測遇到不確定的題目，請選「我不會」，不要亂猜。系統會從適合你的地方開始。',
  '點擊對話或按「繼續」才會進到下一句，依自己的步調慢慢學。',
  '看不懂時按「不懂這一步」，會展開更詳細的說明。',
  '互動模組可以直接拖曳調整，看圖形和數值怎麼變，答錯也會告訴你錯在哪。',
  '想問問題時按「提問與討論」，需要先按「啟用本次 AI」。',
  '手機請直立使用，簡報會自動重排成好讀的單欄。',
] as const;

export const tipAt = (index: number): string => CLASSROOM_TIPS[((index % CLASSROOM_TIPS.length) + CLASSROOM_TIPS.length) % CLASSROOM_TIPS.length];
