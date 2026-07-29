const express = require('express');
const router = express.Router();
const validacionController = require('../controllers/validacionController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

const Validacion = [ROLES.ADMIN];
/**
 * @route   POST /api/validaciones/gestionar
 * @desc    Aprobar o rechazar (mandar a corregir) resultados médicos
 * @access  Privado (Admin)
 */
router.post('/gestionar', verifyToken, checkRole(Validacion), validacionController.gestionarValidacion);

module.exports = router;