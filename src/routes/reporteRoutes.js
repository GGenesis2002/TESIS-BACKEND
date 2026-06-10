const express = require('express');
const router = express.Router();
const reporteController = require('../controllers/reporteController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');


/**
 * @route   GET /api/reportes/descargar/:id_orden
 * @desc    Obtener el PDF final con QR y Firmas
 * @access  Privado (Cualquier usuario autenticado con permiso)
 */
router.get('/descargar/:id_orden', verifyToken, reporteController.generarResultadoPDF);

module.exports = router;