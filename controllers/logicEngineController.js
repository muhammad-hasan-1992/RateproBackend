// controllers/logicEngineController.js
const LogicRule = require('../models/LogicRule');

exports.evaluateLogic = async (req, res) => {
  try {
    const { surveyId } = req.params;
    const { answers } = req.body; // { "Q1": 2, "Q2": "Support" }

    const rules = await LogicRule.find({ survey: surveyId, isActive: true })
      .sort({ priority: -1 });

    const result = {
      show: [],
      hide: [],
      redirect: null,
      disableNext: false,
      prefill: {},
      endSurvey: false
    };

    for (const rule of rules) {
      let allMatch = rule.conditions.logic === 'AND';
      
      for (const cond of rule.conditions.items) {
        const answer = answers[cond.questionId];
        const match = evaluateCondition(answer, cond.operator, cond.value);
        
        if (rule.conditions.logic === 'AND' && !match) allMatch = false;
        if (rule.conditions.logic === 'OR' && match) allMatch = true;
      }

      if (allMatch) {
        rule.actions.forEach(action => {
          if (action.type === 'SHOW') result.show.push(action.targetId);
          if (action.type === 'HIDE') result.hide.push(action.targetId);
          if (action.type === 'REDIRECT') result.redirect = action.targetId;
          if (action.type === 'DISABLE_NEXT') result.disableNext = true;
          if (action.type === 'PREFILL') result.prefill[action.targetId] = action.value;
          if (action.type === 'END_SURVEY') result.endSurvey = true;
        });
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function evaluateCondition(answer, operator, value) {
  if (answer === undefined || answer === null) return false;
  
  switch (operator) {
    case '==': return answer == value;
    case '!=': return answer != value;
    case '>': return Number(answer) > Number(value);
    case '<': return Number(answer) < Number(value);
    case '>=': return Number(answer) >= Number(value);
    case '<=': return Number(answer) <= Number(value);
    case 'contains': return String(answer).toLowerCase().includes(String(value).toLowerCase());
    case 'in': return value.includes(answer);
    case 'exists': return answer !== null && answer !== '';
    default: return false;
  }
}