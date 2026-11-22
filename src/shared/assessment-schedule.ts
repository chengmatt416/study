interface ScheduledAssessment { start_date: string | null; end_date: string | null }

export function nextAssessment<T extends ScheduledAssessment>(assessments: T[], today: string): T | undefined {
  const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
  return assessments.filter((assessment) => {
    const end = date(assessment.end_date) ?? date(assessment.start_date);
    return !end || end >= today;
  }).sort((a, b) => {
    const startA = date(a.start_date), startB = date(b.start_date);
    const orderA = startA ? (startA < today ? today : startA) : date(a.end_date) ?? "9999-12-31";
    const orderB = startB ? (startB < today ? today : startB) : date(b.end_date) ?? "9999-12-31";
    return orderA.localeCompare(orderB) || (date(a.end_date) ?? orderA).localeCompare(date(b.end_date) ?? orderB);
  })[0];
}
