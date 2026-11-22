import { PRACTICE_KINDS, type PracticeKind, type PracticeLevel, type PracticeScale, type PracticeSubject } from "../../../shared/practice";

export type PracticeLane = { kind: PracticeKind; level: PracticeLevel; subjectIds: string[] };

export function practiceLanes(subjects: PracticeSubject[], kinds: PracticeKind[], levels: Record<PracticeScale, PracticeLevel>): PracticeLane[] {
  const lanes: PracticeLane[] = [];
  for (const scale of ["ib", "general"] as const) {
    const level = levels[scale];
    const matching = subjects.filter(subject => subject.practice_scale === scale);
    for (const kind of PRACTICE_KINDS) {
      if (!kinds.includes(kind)) continue;
      const subjectIds = matching.filter(subject => subject.levels[level]?.[kind]).map(subject => subject.id);
      if (subjectIds.length) lanes.push({ kind, level, subjectIds });
    }
  }
  return lanes;
}
