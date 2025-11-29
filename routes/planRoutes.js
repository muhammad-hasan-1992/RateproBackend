// routes/planRoutes.js
const express = require('express');
const router = express.Router();
const {
  createPlan,
  getAllPlans,
  getPlanById,
  updatePlan,
  deletePlan,
  togglePlanStatus
} = require('../controllers/planController');
const { protect } = require('../middlewares/authMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');

router.get('/', getAllPlans);                    // ← YE PUBLIC HONA CHAHIYE
router.get('/:id', getPlanById);

// Only admin can manage plans
router.use(protect);
router.use(allowRoles('admin'));

router
  .route('/')
  .get(getAllPlans)
  .post(createPlan);

router
  .route('/:id')
  .get(getPlanById)
  .put(updatePlan)
  .delete(deletePlan);

router
  .route('/:id/toggle')
  .patch(togglePlanStatus);

module.exports = router;