const express = require('express');
const router = express.Router();
const validacionController = require('../controllers/validacionController');
const { verifyToken } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/validaciones/gestionar
 * @desc    Aprobar o rechazar (mandar a corregir) resultados médicos
 * @access  Privado (Admin)
 */
router.post('/gestionar', verifyToken, validacionController.gestionarValidacion);

module.exports = router;