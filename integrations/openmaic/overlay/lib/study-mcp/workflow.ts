export const MAX_CONTEXT_BYTES = 24_000_000;
export const CONTEXT_CHUNK_CHARS = 24_000;
export const REVIEW_CATEGORIES = [
  "source_accuracy", "schema", "teaching", "interaction", "accessibility",
] as const;
export interface McpVerification {
  request_sha256: string;
  checks: { category: typeof REVIEW_CATEGORIES[number]; evidence: string }[];
  remaining_issues: string[];
}

export const MODEL_WORKFLOW = {
  protocol: "study-model-review/v1",
  verification_required: true,
  preflight_required: true,
  review_sequence: ["read_complete_context", "plan_privately", "draft", "independent_check", "correct", "validate_openmaic_core_step", "submit_unchanged_with_receipt"],
  review_categories: REVIEW_CATEGORIES,
  instructions: "On resume, a pending task's validation_receipt identifies its already stored reviewed draft: commit it with task_id, expected_version and validation_receipt only, without regenerating or retransferring the output. Otherwise read the complete official request, response format and declared tools: validation is refused until the context has been read from offset 0 to its end. Before writing, plan the current bounded teaching task privately: what this turn must teach or assess, which blueprint chapter, objectives and new concepts it serves, which source pages support it, what the learner already knows at this point and where they are most likely to go wrong; preserve dependencies and source coverage. Draft, then independently check source facts, calculations, units, answers, schema/tool arguments, learning sequence, interaction boundaries, mobile and keyboard access. Correct problems before submission. Supply concise, task-specific verification evidence for each category; mark a category not applicable with a reason when appropriate. Evidence copied across categories or repeated word for word from the previous turn is rejected. Do not send private reasoning or claim browser/scientific tests that were not performed. After checking your draft, perform a separate reviewer pass: recompute answers without relying on the draft, check cited source coverage and prerequisites, test boundary cases, and distinguish checks actually executed from reasoned checks. Resolve every issue, then call validate_openmaic_core_step with the complete candidate. Correct returned errors and repeat validation until ok=true. When validation succeeds, submit only task_id, expected_version and validation_receipt, omitting output to avoid regenerating and retransferring long drafts. The core commits that exact stored draft. Any change requires another validation. Review is a generator attestation, not proof of factual or browser correctness.",
} as const;

/** Evidence texts of a review with case and spacing folded, to compare what was written rather than how. */
export function reviewEvidence(value: unknown): string[] {
  const checks = (value as McpVerification | undefined)?.checks;
  return Array.isArray(checks) ? checks.flatMap(check => typeof check?.evidence === "string" ? [check.evidence.replace(/\s+/g, " ").trim().toLowerCase()] : []) : [];
}

export function verificationErrors(value: unknown, requestHash: string): string[] {
  if (!value || typeof value !== "object") return ["output.verification is required"];
  const review = value as McpVerification;
  const errors: string[] = [];
  if (review.request_sha256 !== requestHash) errors.push("verification.request_sha256 must match this task context");
  if (!Array.isArray(review.remaining_issues) || review.remaining_issues.length !== 0)
    errors.push("Resolve remaining issues before submitting; remaining_issues must be []");
  if (!Array.isArray(review.checks) || review.checks.length !== REVIEW_CATEGORIES.length) {
    errors.push("Provide one evidence check per review category");
  } else {
    for (const category of REVIEW_CATEGORIES) {
      const checks = review.checks.filter(check => check && check.category === category);
      if (checks.length !== 1 || typeof checks[0]?.evidence !== "string" || checks[0].evidence.trim().length < 20 || checks[0].evidence.length > 2000)
        errors.push(`Provide 20–2000 characters of specific evidence for ${category}`);
    }
    // One sentence pasted into several categories is a form filled in, not a review.
    const evidence = reviewEvidence(review);
    if (!errors.length && new Set(evidence).size !== evidence.length)
      errors.push("Each review category needs its own evidence: several categories repeat the same text. State what was checked for each one, or why it does not apply to this turn");
  }
  return errors;
}

export { outputErrors as modelOutputErrors } from "./output-validation";
