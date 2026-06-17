const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  toggleCategoryFeatured,
  reorderCategories,
  getFeaturedCategories,
  getHomeCategories,
  addSubcategory,
  updateSubcategory,
  deleteSubcategory,
} = require('../controllers/category.controller');

const router = express.Router();

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return next();
  }
  return authMiddleware(req, res, next);
}

router.get('/', optionalAuth, getCategories);
router.get('/featured', getFeaturedCategories);
router.get('/home', getHomeCategories);
router.post('/', authMiddleware, requireAdmin, createCategory);
router.patch('/reorder', authMiddleware, requireAdmin, reorderCategories);
router.put('/:id', authMiddleware, requireAdmin, updateCategory);
router.patch('/:id/status', authMiddleware, requireAdmin, toggleCategoryStatus);
router.patch('/:id/featured', authMiddleware, requireAdmin, toggleCategoryFeatured);
router.delete('/:id', authMiddleware, requireAdmin, deleteCategory);

router.post('/:id/subcategories', authMiddleware, requireAdmin, addSubcategory);
router.put('/:id/subcategories/:subId', authMiddleware, requireAdmin, updateSubcategory);
router.delete('/:id/subcategories/:subId', authMiddleware, requireAdmin, deleteSubcategory);

module.exports = router;
