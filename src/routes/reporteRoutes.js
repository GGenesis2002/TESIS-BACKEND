const express = require('express');
const router = express.Router();
const reporteController = require('../controllers/reporteController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');


/**
 * @route   GET /api/reportes/descargar/:id_orden
 * @desc    Obtener el PDF final con QR y Firmas
 * @access  Privado (Cualquier usuario autenticado con permiso)
 */

const ROLES = require('../config/roles');

const PDF = [ROLES.ADMIN, ROLES.PACIENTE, ROLES.ESPECIALISTA, ROLES.ASISTENTE, ROLES.TECNICO];

router.get('/descargar/:id_orden', verifyToken, checkRole(PDF), reporteController.generarResultadoPDF);

module.exports = router;