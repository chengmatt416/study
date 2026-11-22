export const EXAM_TEMPLATE = (title: string) => `---
title: ${title}
time_limit_min: 45
calculators: [scientific, graphing, stats1, stats2]
---

# ${title}

> 外層題目用 4 個冒號 \`::::question\`，內層選項/小題用 3 個冒號 \`:::choices\`、\`:::part\`。
> 答案請在「答案 JSON」分頁設定（可按「從題目產生樣板」）。

## Section A　選擇題

::::question{#q1}
直線通過 $A(1,2)$ 與 $B(4,8)$，其斜率為何？

:::choices
- (A) $\\tfrac12$
- (B) $2$
- (C) $3$
- (D) $6$
:::
::::

## Section B　填空與計算

::::question{#q2}
將 $\\dfrac{1}{(3-\\sqrt2)^2}$ 化簡為 $a+b\\sqrt2$，則 $a=$ :blank{#a}，$b=$ :blank{#b}（以分數或 3 位有效數字作答）
::::

:::solution{for=q2}
$(3-\\sqrt2)^2 = 11-6\\sqrt2$，有理化得 $\\dfrac{11+6\\sqrt2}{49}$。
:::
`;
