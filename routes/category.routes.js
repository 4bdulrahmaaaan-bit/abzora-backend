const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  addSubcategory,
  updateSubcategory,
  deleteSubcategory,
} = require('../controllers/category.controller');

const router = express.Router();

router.get('/', getCategories);
router.post('/', authMiddleware, createCategory);
router.put('/:id', authMiddleware, updateCategory);
router.patch('/:id/status', authMiddleware, toggleCategoryStatus);
router.delete('/:id', authMiddleware, deleteCategory);

router.post('/:id/subcategories', authMiddleware, addSubcategory);
router.put('/:id/subcategories/:subId', authMiddleware, updateSubcategory);
router.delete('/:id/subcategories/:subId', authMiddleware, deleteSubcategory);

module.exports = router;
