const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
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
router.post('/', authMiddleware, createCategory);
router.patch('/reorder', authMiddleware, reorderCategories);
router.put('/:id', authMiddleware, updateCategory);
router.patch('/:id/status', authMiddleware, toggleCategoryStatus);
router.patch('/:id/featured', authMiddleware, toggleCategoryFeatured);
router.delete('/:id', authMiddleware, deleteCategory);

router.post('/:id/subcategories', authMiddleware, addSubcategory);
router.put('/:id/subcategories/:subId', authMiddleware, updateSubcategory);
router.delete('/:id/subcategories/:subId', authMiddleware, deleteSubcategory);

module.exports = router;
