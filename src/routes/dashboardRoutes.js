const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

const { verifyToken } = require('../middlewares/authMiddleware');

/**
 * @route   GET /api/dashboard/admin
 */
router.get('/admin', verifyToken, dashboardController.getAdminStats);

/**
 * @route   GET /api/dashboard/secretaria
 */
router.get('/secretaria', verifyToken, dashboardController.getAsistenAnalistaStats);

/**
 * @route   GET /api/dashboard/secretaria/reporte
 * @desc    Descarga segura de reportes en formato CSV para Excel
 */
router.get('/secretaria/reporte', verifyToken, dashboardController.descargarReporteMensual);

/**
 * @route   GET /api/dashboard/tecnico
 */
router.get('/tecnico', verifyToken, dashboardController.getTecnicoStats);

router.get('/alertas', verifyToken, (req, res) => {
    res.redirect(307, '/api/notificaciones');
});

router.get('/auditoria', verifyToken, dashboardController.getAuditoria);
router.get('/arqueo-hoy', verifyToken, dashboardController.getArqueoCajaHoy);
module.exports = router;