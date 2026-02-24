// services/survey/validateSurveyForPublishService.js
// ============================================================================
// Pre-Publish Validation Service
//
// Validates survey data before publishing. Checks:
// 1. Required content (questions, audience)
// 2. Per-question content validation (text, options)
// 3. Logic rule referential integrity (orphan + self-reference)
// 4. Circular loop detection (DFS with visited + recStack)
// 5. Logic rules soft limit (max 10 per question)
// ============================================================================

const validateSurveyForPublish = (survey) => {
  const errors = [];

  // ── 1. Required Content ────────────────────────────────────────────
  if (!survey.questions?.length) {
    errors.push("Survey must have at least one question");
  }

  if (!survey.targetAudience?.audienceType) {
    errors.push("Target audience must be defined");
  }

  if (!survey.questions?.length) {
    return { valid: false, errors };
  }

  // ── 2. Build question lookup map (O(1) access) ────────────────────
  const questionIds = new Set(survey.questions.map(q => q.id));
  const questionMap = {};
  survey.questions.forEach(q => { questionMap[q.id] = q; });

  // ── 3. Per-Question Content Validation ─────────────────────────────
  const choiceTypes = new Set(["radio", "checkbox", "yesno", "select", "imageChoice"]);

  survey.questions.forEach((q, index) => {
    // Question text required
    if (!q.questionText && !q.title) {
      errors.push(`Question ${index + 1} is missing question text`);
    }

    // Choice-type questions must have ≥2 options
    if (choiceTypes.has(q.type) && (!q.options || q.options.length < 2)) {
      errors.push(
        `Question "${q.questionText || q.title || index + 1}" (${q.type}) must have at least 2 options`
      );
    }

    // Soft limit: max 10 logic rules per question
    if (q.logicRules && q.logicRules.length > 10) {
      errors.push(
        `Question "${q.questionText || q.title || index + 1}" has ${q.logicRules.length} logic rules (max 10)`
      );
    }
  });

  // ── 4. Logic Rule Referential Integrity ────────────────────────────
  survey.questions.forEach(q => {
    (q.logicRules || []).forEach((rule, ruleIndex) => {
      if (rule.nextQuestionId) {
        // Orphan reference check
        if (!questionIds.has(rule.nextQuestionId)) {
          errors.push(
            `Logic rule ${ruleIndex + 1} in "${q.questionText || q.id}" references non-existent question`
          );
        }
        // Self-reference check
        if (rule.nextQuestionId === q.id) {
          errors.push(
            `Logic rule ${ruleIndex + 1} in "${q.questionText || q.id}" references itself (self-loop)`
          );
        }
      }
    });

    // Default branch validation
    if (q.defaultNextQuestionId) {
      if (!questionIds.has(q.defaultNextQuestionId)) {
        errors.push(
          `Default branch in "${q.questionText || q.id}" references non-existent question`
        );
      }
      if (q.defaultNextQuestionId === q.id) {
        errors.push(
          `Default branch in "${q.questionText || q.id}" references itself`
        );
      }
    }
  });

  // ── 5. Circular Loop Detection (DFS with visited + recStack) ───────
  // Standard directed graph cycle detection algorithm.
  // visited = globally processed nodes, recStack = current recursion path
  const visited = new Set();
  const recStack = new Set();

  const detectCycle = (questionId) => {
    if (recStack.has(questionId)) return true;   // Back-edge = cycle
    if (visited.has(questionId)) return false;    // Already fully explored

    visited.add(questionId);
    recStack.add(questionId);

    const q = questionMap[questionId];
    if (q) {
      // Check all logic rule branches
      for (const rule of (q.logicRules || [])) {
        if (rule.nextQuestionId && detectCycle(rule.nextQuestionId)) return true;
      }
      // Check default branch
      if (q.defaultNextQuestionId && detectCycle(q.defaultNextQuestionId)) return true;
    }

    recStack.delete(questionId); // Remove from stack after full exploration
    return false;
  };

  for (const q of survey.questions) {
    if (detectCycle(q.id)) {
      errors.push(`Circular logic detected involving question "${q.questionText || q.id}"`);
      break; // One cycle error is enough
    }
  }

  return { valid: errors.length === 0, errors };
};

module.exports = { validateSurveyForPublish };